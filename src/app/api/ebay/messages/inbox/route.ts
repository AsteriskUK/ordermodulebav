import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { htmlEmailToText, looksLikeHtmlEmail } from '@/lib/html-text';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const MSG_BASE = 'https://api.ebay.com/commerce/message/v1';
const MSG_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.message';

// How many conversation pages (50 each) to walk per sync call. Incremental syncs
// stop early at the watermark; this only bounds the very first backfill so a
// single serverless invocation can't run away on accounts with 13k+ threads.
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const TIME_BUDGET_MS = 8000;          // budget for the incremental (newest-first) passes
const BACKFILL_BUDGET_MS = 20000;     // overall budget incl. the historical backfill pass
const BACKFILL_MAX_PAGES = 60;        // historical conversations per run (× PAGE_SIZE)
const LAST_SYNC_KEY = 'ebay_messages_last_sync';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  // Message-scoped token cache, separate from the sell.fulfillment token cached
  // under `ebay_access_token` (eBay access tokens are scope-bound).
  const [{ data: atRow }, { data: rtRow }, { data: expRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_access_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_refresh_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_token_expires_at').single(),
  ]);

  const accessToken = atRow?.value;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? rtRow?.value;
  const expiresAt = Number(expRow?.value ?? 0);
  if (!refreshToken) return null;
  if (accessToken && Date.now() < expiresAt - 5 * 60 * 1000) return accessToken;

  const credentials = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: MSG_SCOPE,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[eBay inbox] token refresh failed:', res.status, errText);
    return null;
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: 'ebay_msg_access_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_msg_token_expires_at', value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

// Upsert messages, tolerating the message_html column not yet existing (its
// migration may not have been applied). On the "column does not exist" error we
// retry once without message_html so the eBay inbox keeps syncing regardless.
async function upsertMessages(
  supabase: ReturnType<typeof getSupabase>,
  rows: MessageRow[],
  opts: { onConflict: string; ignoreDuplicates?: boolean },
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.from('ebay_messages').upsert(rows, opts);
  // 42703 = Postgres "column does not exist"; PGRST204 = PostgREST schema-cache
  // miss. Either way, retry without message_html so the inbox keeps syncing.
  if (error && (error.code === '42703' || error.code === 'PGRST204') && /message_html/.test(error.message)) {
    const stripped = rows.map(({ message_html: _omit, ...rest }) => rest);
    return supabase.from('ebay_messages').upsert(stripped, opts);
  }
  return { error };
}

function ebayHeaders(token: string) {
  return {
    'Authorization': `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    'Content-Type': 'application/json',
  };
}

interface EbayApiMessage {
  messageId?: string;
  senderUsername?: string;
  recipientUsername?: string;
  messageBody?: string;
  createdDate?: string;
  readStatus?: boolean;
  subject?: string;
  messageMedia?: { mediaName?: string; mediaType?: string; mediaUrl?: string }[];
}

interface MessageRow {
  ebay_message_id: string;
  conversation_id?: string;
  direction: 'sent' | 'received';
  order_id: string;
  item_id?: string | null;
  buyer_username: string;
  sender_username?: string | null;
  contact_reason?: string;
  message_text: string;
  message_html?: string | null;   // original HTML for "From eBay" emails (invoices, notices)
  media_urls?: string[];
  conversation_type: string;   // FROM_MEMBERS (client) | FROM_EBAY (eBay)
  sent_at: string;
  status: string;
}

// The seller's own eBay username, used to label message direction. Buyer-initiated
// (FROM_MEMBERS) threads contain messages from both sides; without our username we
// can't tell a reply we sent from a buyer message — and mislabel our own outgoing
// replies as the "buyer", so our own store id shows up as the client. Prefer the
// env var, else fall back to the auto-detected value stored in app_settings.
let SELLER_USERNAME = (process.env.EBAY_SELLER_USERNAME ?? '').toLowerCase();

async function ensureSellerUsername(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  if (SELLER_USERNAME) return;
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'ebay_seller_username').single();
  if (data?.value) SELLER_USERNAME = String(data.value).toLowerCase();
}

function buildRow(
  msg: EbayApiMessage,
  conv: { conversationId?: string; referenceId?: string },
  conversationType: string,
): MessageRow | null {
  if (!msg.messageId) return null;
  const sender = (msg.senderUsername ?? '').toLowerCase();
  // eBay-originated messages are always inbound. For member threads, received
  // unless we know the sender is us.
  const direction: 'sent' | 'received' = conversationType === 'FROM_EBAY'
    ? 'received'
    : (SELLER_USERNAME && sender === SELLER_USERNAME ? 'sent' : 'received');
  const buyerUsername = conversationType === 'FROM_EBAY'
    ? (msg.senderUsername ?? 'eBay')
    : (direction === 'received' ? (msg.senderUsername ?? 'unknown') : (msg.recipientUsername ?? 'unknown'));
  return {
    ebay_message_id: msg.messageId,
    conversation_id: conv.conversationId,
    direction,
    order_id: conv.referenceId ?? conv.conversationId ?? 'unknown',
    item_id: conv.referenceId ?? null,
    buyer_username: buyerUsername,
    sender_username: msg.senderUsername ?? null,
    contact_reason: msg.subject ?? (conversationType === 'FROM_EBAY' ? 'EBAY_MESSAGE' : 'BUYER_MESSAGE'),
    message_text: htmlEmailToText(msg.messageBody ?? ''),
    // Keep the raw HTML for eBay system emails so they can be previewed as the
    // original (rendered) email; buyer messages are plain text, so leave null.
    message_html: looksLikeHtmlEmail(msg.messageBody ?? '') ? msg.messageBody : null,
    media_urls: (msg.messageMedia ?? []).map((m) => m.mediaUrl).filter((u): u is string => !!u),
    conversation_type: conversationType,
    sent_at: msg.createdDate ?? new Date().toISOString(),
    status: direction === 'received' && msg.readStatus === false ? 'unread' : 'read',
  };
}

// GET /api/ebay/messages/inbox
//   (no params)            → return cached messages from Supabase (fast, no eBay calls)
//   ?conversationId=<id>   → fetch that thread's full history from eBay, upsert, return it
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  await ensureSellerUsername(supabase);
  const conversationId = new URL(req.url).searchParams.get('conversationId');

  if (conversationId) {
    const conversationType = new URL(req.url).searchParams.get('conversationType') || 'FROM_MEMBERS';
    const token = await getAccessToken();
    if (token) {
      const res = await fetch(
        `${MSG_BASE}/conversation/${conversationId}?conversation_type=${conversationType}&limit=50`,
        { headers: ebayHeaders(token) }
      );
      if (res.ok) {
        const data = await res.json() as { messages?: EbayApiMessage[]; referenceId?: string };
        // The thread endpoint usually omits referenceId (the conversation-list
        // endpoint carries it), so fall back to the item_id we already stored —
        // otherwise this upsert would null out the listing link on every open.
        let refId = data.referenceId;
        if (!refId) {
          const { data: existing } = await supabase
            .from('ebay_messages')
            .select('item_id')
            .eq('conversation_id', conversationId)
            .not('item_id', 'is', null)
            .limit(1);
          refId = existing?.[0]?.item_id ?? undefined;
        }
        const rows = (data.messages ?? [])
          .map((m) => buildRow(m, { conversationId, referenceId: refId }, conversationType))
          .filter((r): r is MessageRow => r !== null);
        if (rows.length) {
          // Update on conflict (not ignore) so existing rows get sender_username backfilled.
          await upsertMessages(supabase, rows, { onConflict: 'ebay_message_id' });
        }
      } else {
        console.warn('[eBay inbox] thread fetch failed', conversationId, res.status);
      }
    }
    const { data: messages } = await supabase
      .from('ebay_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });
    return NextResponse.json({ messages: messages ?? [] });
  }

  // Supabase caps a single response at 1000 rows, so page through all messages —
  // otherwise older conversations drop off the list as active ones accumulate.
  const PAGE = 1000;
  const MAX = 30000;
  const all: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data } = await supabase
      .from('ebay_messages')
      .select('*')
      .order('sent_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return NextResponse.json({ messages: all });
}

// Incremental sync of one conversation type (FROM_MEMBERS = client, FROM_EBAY =
// eBay). Walks pages newest-first, stops at that type's watermark, saves only new
// messages. Returns how many were saved.
async function syncConversationType(
  supabase: ReturnType<typeof getSupabase>,
  token: string,
  conversationType: string,
  startedAt: number,
): Promise<{ synced: number; lastStatus: number }> {
  const wmKey = `${LAST_SYNC_KEY}_${conversationType}`;
  const { data: wmRow } = await supabase.from('app_settings').select('value').eq('key', wmKey).single();
  const watermark = wmRow?.value ? new Date(wmRow.value).getTime() : 0;

  let offset = 0;
  let synced = 0;
  let newestSeen = watermark;
  let lastStatus = 0;
  let reachedKnown = false;

  for (let page = 0; page < MAX_PAGES && !reachedKnown; page++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const res = await fetch(
      `${MSG_BASE}/conversation?conversation_type=${conversationType}&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: ebayHeaders(token) }
    );
    lastStatus = res.status;
    if (!res.ok) {
      console.error(`[eBay inbox] ${conversationType} list failed`, res.status, (await res.text()).slice(0, 300));
      break;
    }

    const data = await res.json() as {
      conversations?: Array<{ conversationId?: string; referenceId?: string; latestMessage?: EbayApiMessage }>;
    };
    const conversations = data.conversations ?? [];
    if (conversations.length === 0) break;

    const rows: MessageRow[] = [];
    let pageNewest = 0;
    for (const conv of conversations) {
      const lm = conv.latestMessage;
      const created = lm?.createdDate ? new Date(lm.createdDate).getTime() : 0;
      if (created && created <= watermark) { reachedKnown = true; break; }
      if (created > pageNewest) pageNewest = created;
      const row = lm && buildRow(lm, conv, conversationType);
      if (row) rows.push(row);
    }

    if (rows.length) {
      const { error } = await upsertMessages(supabase, rows, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
      if (error) { console.error('[eBay inbox] upsert error:', error.message); break; }
      synced += rows.length;
    }

    if (pageNewest > newestSeen) newestSeen = pageNewest;
    offset += PAGE_SIZE;
    if (conversations.length < PAGE_SIZE) break;
  }

  if (newestSeen > watermark) {
    await supabase.from('app_settings').upsert({ key: wmKey, value: new Date(newestSeen).toISOString(), updated_at: new Date().toISOString() });
  }
  return { synced, lastStatus };
}

// Historical backfill for a conversation type — the incremental pass only covers
// the newest ~1000; this walks older pages from a saved offset (a chunk per run)
// so all historical eBay return/refund/INR notifications come in over time.
async function backfillConversationType(
  supabase: ReturnType<typeof getSupabase>,
  token: string,
  conversationType: string,
  startedAt: number,
): Promise<number> {
  const key = `ebay_messages_backfill_offset_${conversationType}`;
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).single();
  let offset = Number(data?.value ?? '0');
  let synced = 0;

  for (let page = 0; page < BACKFILL_MAX_PAGES; page++) {
    if (Date.now() - startedAt > BACKFILL_BUDGET_MS) break;
    const res = await fetch(
      `${MSG_BASE}/conversation?conversation_type=${conversationType}&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: ebayHeaders(token) }
    );
    if (!res.ok) break;
    const data2 = await res.json() as {
      conversations?: Array<{ conversationId?: string; referenceId?: string; latestMessage?: EbayApiMessage }>;
    };
    const conversations = data2.conversations ?? [];
    if (conversations.length === 0) break;

    const rows: MessageRow[] = [];
    for (const conv of conversations) {
      const row = conv.latestMessage && buildRow(conv.latestMessage, conv, conversationType);
      if (row) rows.push(row);
    }
    // Which of this page are genuinely new? (eBay retains little old history, so
    // once a page is all-known we're done — reset the offset for next time.)
    const pageIds = rows.map((r) => r.ebay_message_id);
    const { data: known } = await supabase.from('ebay_messages').select('ebay_message_id').in('ebay_message_id', pageIds);
    const knownSet = new Set((known ?? []).map((k) => k.ebay_message_id));
    const newRows = rows.filter((r) => !knownSet.has(r.ebay_message_id));
    if (newRows.length) {
      const { error } = await upsertMessages(supabase, newRows, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
      if (error) break;
      synced += newRows.length;
    }
    offset += PAGE_SIZE;
    if (newRows.length === 0 || conversations.length < PAGE_SIZE) { offset = 0; break; } // nothing new / end → restart next run
  }

  await supabase.from('app_settings').upsert({ key, value: String(offset), updated_at: new Date().toISOString() });
  return synced;
}

// POST /api/ebay/messages/inbox — incremental sync of both client and eBay
// conversation lists (sharing one serverless time budget).
export async function POST() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();
  await ensureSellerUsername(supabase);
  const startedAt = Date.now();

  const members = await syncConversationType(supabase, token, 'FROM_MEMBERS', startedAt);
  const ebay = await syncConversationType(supabase, token, 'FROM_EBAY', startedAt);

  // With remaining budget, backfill older history — eBay notifications
  // (returns/refunds/INR) first, then client threads.
  let backfilled = 0;
  if (Date.now() - startedAt < BACKFILL_BUDGET_MS) backfilled += await backfillConversationType(supabase, token, 'FROM_EBAY', startedAt);
  if (Date.now() - startedAt < BACKFILL_BUDGET_MS) backfilled += await backfillConversationType(supabase, token, 'FROM_MEMBERS', startedAt);

  return NextResponse.json({
    synced: members.synced + ebay.synced + backfilled,
    client: members.synced,
    ebay: ebay.synced,
    backfilled,
    ebayApiStatus: members.lastStatus || ebay.lastStatus,
  });
}

// PATCH /api/ebay/messages/inbox — mark conversation(s) as read (both eBay + Supabase)
export async function PATCH(req: Request) {
  const { ids, conversationIds, conversationType, read = true } = await req.json() as {
    ids: string[];                 // Supabase row IDs
    conversationIds?: string[];    // eBay conversation IDs (optional)
    conversationType?: string;     // FROM_MEMBERS or FROM_EBAY
    read?: boolean;                // true = mark read, false = mark unread
  };

  const supabase = getSupabase();

  // Update Supabase — received messages toggle unread/read; our sent stay 'sent'.
  await supabase.from('ebay_messages').update({ status: read ? 'read' : 'unread' }).in('id', ids).eq('direction', 'received');

  // Mirror the read/unread status on eBay too
  if (conversationIds?.length) {
    const token = await getAccessToken();
    if (token) {
      const convType = conversationType ?? 'FROM_MEMBERS';
      await Promise.all(
        conversationIds.map((cid) =>
          fetch(`${MSG_BASE}/update_conversation`, {
            method: 'POST',
            headers: ebayHeaders(token),
            body: JSON.stringify({ conversationId: cid, conversationType: convType, read }),
          })
        )
      );
    }
  }

  return NextResponse.json({ success: true });
}
