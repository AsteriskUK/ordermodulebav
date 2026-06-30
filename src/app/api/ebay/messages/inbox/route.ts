import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const MSG_BASE = 'https://api.ebay.com/commerce/message/v1';
const MSG_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.message';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  // Use a message-scoped token cache, separate from the sell.fulfillment token
  // cached under `ebay_access_token` by the orders/cancellations routes. eBay
  // access tokens are scope-bound, so sharing the cache means a fulfillment-only
  // token gets reused here and the commerce.message API rejects it.
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

// GET /api/ebay/messages/inbox — sync FROM_MEMBERS conversations and return all messages
export async function GET() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();

  // Step 1: fetch conversation list (buyer-initiated messages only)
  const convRes = await fetch(
    `${MSG_BASE}/conversation?conversation_type=FROM_MEMBERS&limit=50`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'Content-Type': 'application/json',
      },
    }
  );

  const convRaw = await convRes.text();
  console.log('[eBay inbox] conversations status:', convRes.status, 'body:', convRaw.slice(0, 500));

  let syncedCount = 0;

  if (convRes.ok) {
    let convData: {
      conversations?: Array<{
        conversationId?: string;
        conversationStatus?: string;
        conversationType?: string;
        referenceId?: string;   // item ID when referenceType = LISTING
        unreadCount?: number;
        latestMessage?: {
          messageId?: string;
          senderUsername?: string;
          recipientUsername?: string;
          messageBody?: string;
          createdDate?: string;
          readStatus?: boolean;
          subject?: string;
        };
      }>;
      total?: number;
    };
    try { convData = JSON.parse(convRaw); } catch { convData = {}; }

    const conversations = convData.conversations ?? [];

    for (const conv of conversations) {
      if (!conv.conversationId) continue;

      // Step 2: fetch all messages within each conversation
      const msgRes = await fetch(
        `${MSG_BASE}/conversation/${conv.conversationId}?conversation_type=FROM_MEMBERS&limit=50`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
            'Content-Type': 'application/json',
          },
        }
      );

      if (!msgRes.ok) {
        console.warn('[eBay inbox] failed to fetch conversation', conv.conversationId, msgRes.status);
        continue;
      }

      let msgData: {
        messages?: Array<{
          messageId?: string;
          senderUsername?: string;
          recipientUsername?: string;
          messageBody?: string;
          createdDate?: string;
          readStatus?: boolean;
          subject?: string;
        }>;
        conversationType?: string;
      };
      try { msgData = await msgRes.json(); } catch { continue; }

      for (const msg of msgData.messages ?? []) {
        if (!msg.messageId) continue;

        // Determine direction: if sender is buyer (not us), it's received
        // We identify buyer messages as those where senderUsername ≠ recipientUsername of the latest sent msg
        // Simplest heuristic: all messages in FROM_MEMBERS are buyer-initiated threads,
        // but individual messages can be from either party. Skip if readStatus means we sent it.
        const isBuyerMessage = msg.senderUsername && msg.senderUsername !== msg.recipientUsername;
        const direction = isBuyerMessage ? 'received' : 'sent';
        const buyerUsername = direction === 'received'
          ? (msg.senderUsername ?? 'unknown')
          : (msg.recipientUsername ?? 'unknown');

        const { error } = await supabase.from('ebay_messages').upsert({
          ebay_message_id: msg.messageId,
          direction,
          order_id: conv.referenceId ?? conv.conversationId ?? 'unknown',
          item_id: conv.referenceId,
          buyer_username: buyerUsername,
          contact_reason: msg.subject ?? 'BUYER_MESSAGE',
          message_text: msg.messageBody ?? '',
          sent_at: msg.createdDate ?? new Date().toISOString(),
          status: direction === 'received' && msg.readStatus === false ? 'unread' : 'read',
        }, { onConflict: 'ebay_message_id', ignoreDuplicates: true });
        if (!error) syncedCount++;
      }
    }
  }

  // Return all messages (sent + received) from Supabase
  const { data: messages } = await supabase
    .from('ebay_messages')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(500);

  return NextResponse.json({
    messages: messages ?? [],
    synced: syncedCount,
    ebayApiStatus: convRes.status,
    ebayApiPreview: convRaw.slice(0, 300),
  });
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
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
              'Content-Type': 'application/json',
            },
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
