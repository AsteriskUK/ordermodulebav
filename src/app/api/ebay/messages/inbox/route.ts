import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
// eBay Post-Order API for reading buyer messages
const MSG_BASE = 'https://api.ebay.com/post-order/v2/inquiry';
// eBay Messaging API for contact_buyer threads
const MESSAGING_BASE = 'https://api.ebay.com/sell/messaging/v1';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  const [{ data: atRow }, { data: rtRow }, { data: expRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_access_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_refresh_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_token_expires_at').single(),
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
      scope: 'https://api.ebay.com/oauth/api_scope/sell.messaging.write',
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: 'ebay_access_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_token_expires_at', value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

// GET /api/ebay/messages/inbox — sync incoming messages from eBay and return all
export async function GET() {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();

  // Fetch buyer messages from eBay Messaging API
  // eBay returns threads where buyers have contacted us
  const res = await fetch(`${MESSAGING_BASE}/contact_buyer?limit=50`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      'Content-Type': 'application/json',
    },
  });

  let syncedCount = 0;

  const rawText = await res.text();
  console.log('[eBay inbox] status:', res.status, 'body:', rawText.slice(0, 500));

  if (res.ok) {
    let raw: {
      contactBuyerResponses?: Array<{
        itemId?: string;
        orderId?: string;
        recipientUsername?: string;
        messages?: Array<{
          messageId?: string;
          sender?: string;
          receiveDate?: string;
          text?: string;
          subject?: string;
        }>;
      }>;
    };
    try { raw = JSON.parse(rawText); } catch { raw = {}; }

    const threads = raw.contactBuyerResponses ?? [];
    for (const thread of threads) {
      for (const msg of thread.messages ?? []) {
        if (!msg.sender || msg.sender === 'SELLER') continue;
        if (!msg.messageId) continue;
        const { error } = await supabase.from('ebay_messages').upsert({
          ebay_message_id: msg.messageId,
          direction: 'received',
          order_id: thread.orderId ?? thread.itemId ?? 'unknown',
          item_id: thread.itemId,
          buyer_username: thread.recipientUsername ?? msg.sender,
          contact_reason: msg.subject ?? 'BUYER_MESSAGE',
          message_text: msg.text ?? '',
          sent_at: msg.receiveDate ?? new Date().toISOString(),
          status: 'unread',
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
    ebayApiStatus: res.status,
    ebayApiPreview: rawText.slice(0, 300),
  });
}

// PATCH /api/ebay/messages/inbox — mark message(s) as read
export async function PATCH(req: Request) {
  const { ids } = await req.json() as { ids: string[] };
  const supabase = getSupabase();
  await supabase.from('ebay_messages').update({ status: 'read' }).in('id', ids);
  return NextResponse.json({ success: true });
}
