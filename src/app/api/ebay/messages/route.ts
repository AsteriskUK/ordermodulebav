import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MSG_BASE = 'https://api.ebay.com/commerce/message/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const MSG_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.message';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();

  // Message-scoped token cache, kept separate from the sell.fulfillment token
  // cached under `ebay_access_token` (eBay access tokens are scope-bound).
  const [{ data: atRow }, { data: rtRow }, { data: expRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_access_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_refresh_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_msg_token_expires_at').single(),
  ]);

  const accessToken = atRow?.value;
  const refreshToken = process.env.EBAY_REFRESH_TOKEN ?? rtRow?.value;
  const expiresAt = Number(expRow?.value ?? 0);

  if (!refreshToken) return null;

  if (accessToken && Date.now() < expiresAt - 5 * 60 * 1000) {
    return accessToken;
  }

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

  if (!res.ok) return null;
  const data = await res.json() as { access_token: string; expires_in: number };
  const newExpiry = Date.now() + data.expires_in * 1000;
  await getSupabase().from('app_settings').upsert([
    { key: 'ebay_msg_access_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_msg_token_expires_at', value: String(newExpiry), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

// GET /api/ebay/messages?orderId=xxx — fetch messages for an order from Supabase
export async function GET(req: NextRequest) {
  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: messages, error } = await supabase
    .from('ebay_messages')
    .select('*')
    .eq('order_id', orderId)
    .order('sent_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: messages ?? [] });
}

// POST /api/ebay/messages — send a message to a buyer via eBay Message API
export async function POST(req: NextRequest) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const body = await req.json() as {
    orderId: string;
    itemId?: string;
    recipientUsername: string;   // buyer's eBay username (for new conversations)
    conversationId?: string;     // if replying to an existing conversation
    buyerName?: string;
    itemTitle?: string;
    contactReason?: string;
    text: string;
    sentById?: string;
    sentByName?: string;
  };

  const { orderId, itemId, recipientUsername, conversationId, buyerName, itemTitle, contactReason, text, sentById, sentByName } = body;

  if (!text?.trim()) {
    return NextResponse.json({ error: 'Missing required field: text' }, { status: 400 });
  }
  if (!conversationId && !recipientUsername) {
    return NextResponse.json({ error: 'Either conversationId or recipientUsername is required' }, { status: 400 });
  }

  // Build eBay sendMessage payload
  const payload: Record<string, unknown> = {
    messageText: text,
  };

  if (conversationId) {
    // Reply in existing conversation
    payload.conversationId = conversationId;
  } else {
    // New conversation
    payload.otherPartyUsername = recipientUsername;
  }

  // Attach listing reference if we have an item ID
  if (itemId) {
    payload.reference = {
      referenceId: itemId,
      referenceType: 'LISTING',
    };
  }

  const res = await fetch(`${MSG_BASE}/send_message`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
    body: JSON.stringify(payload),
  });

  const supabase = getSupabase();

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[eBay messages] send error:', res.status, errBody);
    await supabase.from('ebay_messages').insert({
      order_id: orderId,
      item_id: itemId,
      buyer_username: recipientUsername,
      buyer_name: buyerName,
      item_title: itemTitle,
      contact_reason: contactReason,
      message_text: text,
      sent_by_id: sentById,
      sent_by_name: sentByName,
      direction: 'sent',
      status: 'failed',
    });
    return NextResponse.json({ error: 'send_failed', message: errBody }, { status: res.status });
  }

  const responseData = await res.json() as { messageId?: string; createdDate?: string };

  // Save sent message to Supabase
  await supabase.from('ebay_messages').insert({
    ebay_message_id: responseData.messageId,
    order_id: orderId,
    item_id: itemId,
    buyer_username: recipientUsername,
    buyer_name: buyerName,
    item_title: itemTitle,
    contact_reason: contactReason,
    message_text: text,
    sent_by_id: sentById,
    sent_by_name: sentByName,
    sent_at: responseData.createdDate ?? new Date().toISOString(),
    direction: 'sent',
    status: 'sent',
  });

  return NextResponse.json({ success: true, messageId: responseData.messageId });
}
