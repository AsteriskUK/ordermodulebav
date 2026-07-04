import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const MSG_BASE  = 'https://api.ebay.com/commerce/message/v1';
const MSG_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.message';

// Serverless time budget — stop before the platform kills the function. Netlify's
// default function timeout is 10s, so we return cleanly at 8.5s and the client
// loops again (progress is persisted via the per-type cursor, so it resumes).
const TIME_BUDGET_MS  = 8_500;
const CONV_PAGE_SIZE  = 50;
// eBay's Messaging API caps the conversation-thread limit at 50 (errorId 355009).
const MSG_PAGE_SIZE   = 50;
const CONV_TYPES      = ['FROM_MEMBERS', 'FROM_EBAY'] as const;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  const [{ data: atRow }, { data: rtRow }, { data: expRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_access_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_refresh_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_token_expires_at').single(),
  ]);
  const accessToken  = atRow?.value;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? rtRow?.value;
  const expiresAt    = Number(expRow?.value ?? 0);
  if (!refreshToken) return null;
  if (accessToken && Date.now() < expiresAt - 5 * 60 * 1000) return accessToken;

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: MSG_SCOPE }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: 'ebay_msg_access_token',    value: data.access_token,                        updated_at: new Date().toISOString() },
    { key: 'ebay_msg_token_expires_at', value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

function ebayHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };
}

const SELLER = (process.env.EBAY_SELLER_USERNAME ?? '').toLowerCase();

interface EbayMsg {
  messageId?: string; senderUsername?: string; recipientUsername?: string;
  messageBody?: string; createdDate?: string; readStatus?: boolean; subject?: string;
  messageMedia?: { mediaUrl?: string }[];
}

function buildRow(msg: EbayMsg, convId: string, refId: string | undefined, convType: string) {
  if (!msg.messageId) return null;
  const sender    = (msg.senderUsername ?? '').toLowerCase();
  const direction = convType === 'FROM_EBAY'
    ? 'received'
    : (SELLER && sender === SELLER ? 'sent' : 'received');
  const buyerUsername = convType === 'FROM_EBAY'
    ? (msg.senderUsername ?? 'eBay')
    : (direction === 'received' ? (msg.senderUsername ?? 'unknown') : (msg.recipientUsername ?? 'unknown'));
  return {
    ebay_message_id:   msg.messageId,
    conversation_id:   convId,
    direction,
    order_id:          refId ?? convId,
    item_id:           refId ?? null,
    buyer_username:    buyerUsername,
    sender_username:   msg.senderUsername ?? null,
    contact_reason:    msg.subject ?? (convType === 'FROM_EBAY' ? 'EBAY_MESSAGE' : 'BUYER_MESSAGE'),
    message_text:      msg.messageBody ?? '',
    media_urls:        (msg.messageMedia ?? []).map((m) => m.mediaUrl).filter(Boolean),
    conversation_type: convType,
    sent_at:           msg.createdDate ?? new Date().toISOString(),
    status:            direction === 'received' && msg.readStatus === false ? 'unread' : 'read',
  };
}

// POST /api/ebay/messages/sync-all
// Full history backfill: walks every conversation page, fetches every thread,
// upserts all messages. Returns when time budget is exhausted or all done.
// Safe to call multiple times — already-saved messages are upserted (no duplicates).
// Pass { reset: true } body to clear watermarks and restart from scratch.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { reset?: boolean };
  const supabase  = getSupabase();
  const token     = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  // Watermark: track which conversations we've already fully fetched (by conversationId).
  // We store a cursor per conversation-type so we can resume after timeouts.
  const CURSOR_KEY = (t: string) => `ebay_messages_full_sync_offset_${t}`;
  if (body.reset) {
    for (const t of CONV_TYPES) {
      await supabase.from('app_settings').upsert({ key: CURSOR_KEY(t), value: '0', updated_at: new Date().toISOString() });
    }
  }

  const startedAt  = Date.now();
  let totalSynced  = 0;
  let totalConvs   = 0;
  let timedOut     = false;

  for (const convType of CONV_TYPES) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { timedOut = true; break; }

    const cursorKey  = CURSOR_KEY(convType);
    const { data: cursorRow } = await supabase.from('app_settings').select('value').eq('key', cursorKey).single();
    let offset = Number(cursorRow?.value ?? 0);

    // Walk conversation list pages from current offset
    convLoop: while (true) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { timedOut = true; break convLoop; }

      const listRes = await fetch(
        `${MSG_BASE}/conversation?conversation_type=${convType}&limit=${CONV_PAGE_SIZE}&offset=${offset}`,
        { headers: ebayHeaders(token) },
      );
      if (!listRes.ok) {
        console.error(`[sync-all] list ${convType} offset=${offset} → ${listRes.status}`);
        break;
      }

      const listData = await listRes.json() as {
        conversations?: Array<{ conversationId?: string; referenceId?: string }>;
        total?: number;
      };
      const conversations = listData.conversations ?? [];
      if (conversations.length === 0) {
        // Done — reset cursor to 0 for next full run
        await supabase.from('app_settings').upsert({ key: cursorKey, value: '0', updated_at: new Date().toISOString() });
        break;
      }

      // Fetch each conversation's full thread. The cursor advances PER conversation
      // (offset + i), not per page — an 8.5s pass can't finish a 50-thread page, so a
      // page-granular cursor would get stuck re-processing the same threads forever.
      for (let i = 0; i < conversations.length; i++) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          timedOut = true;
          await supabase.from('app_settings').upsert({ key: cursorKey, value: String(offset + i), updated_at: new Date().toISOString() });
          break convLoop;
        }
        const conv = conversations[i];
        if (!conv.conversationId) continue;

        let msgOffset = 0;
        while (true) {
          const threadRes = await fetch(
            `${MSG_BASE}/conversation/${conv.conversationId}?conversation_type=${convType}&limit=${MSG_PAGE_SIZE}&offset=${msgOffset}`,
            { headers: ebayHeaders(token) },
          );
          if (!threadRes.ok) break;

          const threadData = await threadRes.json() as { messages?: EbayMsg[]; referenceId?: string };
          const msgs = threadData.messages ?? [];
          if (msgs.length === 0) break;

          const rows = msgs
            .map((m) => buildRow(m, conv.conversationId!, threadData.referenceId ?? conv.referenceId, convType))
            .filter((r): r is NonNullable<typeof r> => r !== null);

          if (rows.length) {
            const { error } = await supabase.from('ebay_messages').upsert(rows, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
            if (error) console.error('[sync-all] upsert error:', error.message);
            else totalSynced += rows.length;
          }

          msgOffset += MSG_PAGE_SIZE;
          if (msgs.length < MSG_PAGE_SIZE) break;
        }

        totalConvs++;
      }

      offset += conversations.length;
      // Persist cursor after a full page completes.
      await supabase.from('app_settings').upsert({ key: cursorKey, value: String(offset), updated_at: new Date().toISOString() });

      if (conversations.length < CONV_PAGE_SIZE) {
        // Reached last page — reset cursor
        await supabase.from('app_settings').upsert({ key: cursorKey, value: '0', updated_at: new Date().toISOString() });
        break;
      }
    }
  }

  return NextResponse.json({
    synced:      totalSynced,
    conversations: totalConvs,
    timedOut,
    elapsed:     Math.round((Date.now() - startedAt) / 1000),
    message:     timedOut
      ? `Synced ${totalSynced} messages from ${totalConvs} threads. Hit time limit — call again to continue.`
      : `Full sync complete: ${totalSynced} messages from ${totalConvs} threads.`,
  });
}
