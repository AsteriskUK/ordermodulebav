import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = 'https://api.ebay.com/sell/messaging/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

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

  if (accessToken && Date.now() < expiresAt - 5 * 60 * 1000) {
    return accessToken;
  }

  // Refresh
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
  const newExpiry = Date.now() + data.expires_in * 1000;
  await supabase.from('app_settings').upsert([
    { key: 'ebay_access_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_token_expires_at', value: String(newExpiry), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

// GET /api/ebay/messages?orderId=xxx — fetch message thread for an order
export async function GET(req: NextRequest) {
  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const res = await fetch(`${BASE_URL}/contact_buyer?item_id=${encodeURIComponent(orderId)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[eBay messages] fetch error:', res.status, body);
    return NextResponse.json({ error: 'ebay_error', message: body }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}

// POST /api/ebay/messages — send a message to a buyer
export async function POST(req: NextRequest) {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const body = await req.json() as {
    orderId: string;
    itemId: string;
    recipientUsername: string;
    buyerName?: string;
    itemTitle?: string;
    contactReason: string;
    text: string;
    sentById?: string;
    sentByName?: string;
  };

  const { orderId, itemId, recipientUsername, buyerName, itemTitle, contactReason, text, sentById, sentByName } = body;

  if (!orderId || !itemId || !recipientUsername || !text) {
    return NextResponse.json({ error: 'Missing required fields: orderId, itemId, recipientUsername, text' }, { status: 400 });
  }

  const payload = {
    recipientUsername,
    subject: contactReason === 'SHIPPING' ? 'Shipping update for your order' :
             contactReason === 'ITEM' ? 'Information about your item' : 'Update regarding your order',
    text,
    orderId,
    itemId,
    contactReason: contactReason || 'ORDER',
  };

  const res = await fetch(`${BASE_URL}/contact_buyer`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[eBay messages] send error:', res.status, errBody);
    // Save failed attempt to Supabase for audit trail
    await getSupabase().from('ebay_messages').insert({
      order_id: orderId,
      item_id: itemId,
      buyer_username: recipientUsername,
      buyer_name: buyerName,
      item_title: itemTitle,
      contact_reason: contactReason,
      message_text: text,
      sent_by_id: sentById,
      sent_by_name: sentByName,
      status: 'failed',
    });
    return NextResponse.json({ error: 'send_failed', message: errBody }, { status: res.status });
  }

  // Save sent message to Supabase
  await getSupabase().from('ebay_messages').insert({
    order_id: orderId,
    item_id: itemId,
    buyer_username: recipientUsername,
    buyer_name: buyerName,
    item_title: itemTitle,
    contact_reason: contactReason,
    message_text: text,
    sent_by_id: sentById,
    sent_by_name: sentByName,
    status: 'sent',
  });

  return NextResponse.json({ success: true });
}
