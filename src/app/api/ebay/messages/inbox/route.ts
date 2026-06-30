import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const MSG_BASE = 'https://api.ebay.com/commerce/message/v1';
const MSG_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.message';

// How many conversation pages (50 each) to walk per sync call. Incremental syncs
// stop early at the watermark; this only bounds the very first backfill so a
// single serverless invocation can't run away on accounts with 13k+ threads.
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const TIME_BUDGET_MS = 8000; // stop walking pages before a serverless timeout
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
}

interface MessageRow {
  ebay_message_id: string;
  conversation_id?: string;
  direction: 'sent' | 'received';
  order_id: string;
  item_id?: string | null;
  buyer_username: string;
  contact_reason?: string;
  message_text: string;
  sent_at: string;
  status: string;
}

// The seller's own eBay username, used to label message direction. Buyer-initiated
// (FROM_MEMBERS) threads contain messages from both sides; without our username we
// can't reliably tell them apart.
const SELLER_USERNAME = (process.env.EBAY_SELLER_USERNAME ?? '').toLowerCase();

function buildRow(
  msg: EbayApiMessage,
  conv: { conversationId?: string; referenceId?: string }
): MessageRow | null {
  if (!msg.messageId) return null;
  const sender = (msg.senderUsername ?? '').toLowerCase();
  // Received unless we know the sender is us.
  const direction: 'sent' | 'received' = SELLER_USERNAME && sender === SELLER_USERNAME ? 'sent' : 'received';
  const buyerUsername = direction === 'received'
    ? (msg.senderUsername ?? 'unknown')
    : (msg.recipientUsername ?? 'unknown');
  return {
    ebay_message_id: msg.messageId,
    conversation_id: conv.conversationId,
    direction,
    order_id: conv.referenceId ?? conv.conversationId ?? 'unknown',
    item_id: conv.referenceId ?? null,
    buyer_username: buyerUsername,
    contact_reason: msg.subject ?? 'BUYER_MESSAGE',
    message_text: msg.messageBody ?? '',
    sent_at: msg.createdDate ?? new Date().toISOString(),
    status: direction === 'received' && msg.readStatus === false ? 'unread' : 'read',
  };
}

// GET /api/ebay/messages/inbox
//   (no params)            → return cached messages from Supabase (fast, no eBay calls)
//   ?conversationId=<id>   → fetch that thread's full history from eBay, upsert, return it
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const conversationId = new URL(req.url).searchParams.get('conversationId');

  if (conversationId) {
    const token = await getAccessToken();
    if (token) {
      const res = await fetch(
        `${MSG_BASE}/conversation/${conversationId}?conversation_type=FROM_MEMBERS&limit=100`,
        { headers: ebayHeaders(token) }
      );
      if (res.ok) {
        const data = await res.json() as { messages?: EbayApiMessage[]; referenceId?: string };
        const rows = (data.messages ?? [])
          .map((m) => buildRow(m, { conversationId, referenceId: data.referenceId }))
          .filter((r): r is MessageRow => r !== null);
        if (rows.length) {
          await supabase.from('ebay_messages').upsert(rows, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
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

  const { data: messages } = await supabase
    .from('ebay_messages')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(1000);
  return NextResponse.json({ messages: messages ?? [] });
}

// POST /api/ebay/messages/inbox — incremental sync of the conversation list.
// Walks pages newest-first, stops at the last-synced watermark, and saves only
// new messages. One API call covers 50 conversations, so this stays well within
// serverless time limits (unlike per-conversation thread fetching).
export async function POST() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();
  const { data: wmRow } = await supabase
    .from('app_settings').select('value').eq('key', LAST_SYNC_KEY).single();
  const watermark = wmRow?.value ? new Date(wmRow.value).getTime() : 0;

  const startedAt = Date.now();
  let offset = 0;
  let synced = 0;
  let newestSeen = watermark;
  let lastStatus = 0;
  let reachedKnown = false;

  for (let page = 0; page < MAX_PAGES && !reachedKnown; page++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const res = await fetch(
      `${MSG_BASE}/conversation?conversation_type=FROM_MEMBERS&limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: ebayHeaders(token) }
    );
    lastStatus = res.status;
    if (!res.ok) {
      console.error('[eBay inbox] conversation list failed', res.status, (await res.text()).slice(0, 300));
      break;
    }

    const data = await res.json() as {
      conversations?: Array<{
        conversationId?: string;
        referenceId?: string;
        latestMessage?: EbayApiMessage;
      }>;
    };
    const conversations = data.conversations ?? [];
    if (conversations.length === 0) break;

    const rows: MessageRow[] = [];
    let pageNewest = 0;
    for (const conv of conversations) {
      const lm = conv.latestMessage;
      const created = lm?.createdDate ? new Date(lm.createdDate).getTime() : 0;
      // Conversations come back newest-first; once we cross the watermark
      // everything beyond is already synced.
      if (created && created <= watermark) { reachedKnown = true; break; }
      if (created > pageNewest) pageNewest = created;
      const row = lm && buildRow(lm, conv);
      if (row) rows.push(row);
    }

    if (rows.length) {
      const { error } = await supabase
        .from('ebay_messages')
        .upsert(rows, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
      // Only advance the watermark for data we actually persisted — otherwise a
      // failed write would make us skip those messages forever on the next sync.
      if (error) { console.error('[eBay inbox] upsert error:', error.message); break; }
      synced += rows.length;
    }

    if (pageNewest > newestSeen) newestSeen = pageNewest;
    offset += PAGE_SIZE;
    if (conversations.length < PAGE_SIZE) break;
  }

  if (newestSeen > watermark) {
    await supabase.from('app_settings').upsert({
      key: LAST_SYNC_KEY,
      value: new Date(newestSeen).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return NextResponse.json({ synced, ebayApiStatus: lastStatus });
}

// PATCH /api/ebay/messages/inbox — mark conversation(s) as read (both eBay + Supabase)
export async function PATCH(req: Request) {
  const { ids, conversationIds, conversationType } = await req.json() as {
    ids: string[];                 // Supabase row IDs
    conversationIds?: string[];    // eBay conversation IDs (optional)
    conversationType?: string;     // FROM_MEMBERS or FROM_EBAY
  };

  const supabase = getSupabase();

  // Update Supabase
  await supabase.from('ebay_messages').update({ status: 'read' }).in('id', ids);

  // Optionally mark as read on eBay too
  if (conversationIds?.length) {
    const token = await getAccessToken();
    if (token) {
      const convType = conversationType ?? 'FROM_MEMBERS';
      await Promise.all(
        conversationIds.map((cid) =>
          fetch(`${MSG_BASE}/update_conversation`, {
            method: 'POST',
            headers: ebayHeaders(token),
            body: JSON.stringify({
              conversationId: cid,
              conversationType: convType,
              read: true,
            }),
          })
        )
      );
    }
  }

  return NextResponse.json({ success: true });
}
