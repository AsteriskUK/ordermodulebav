import { NextResponse } from 'next/server';

const AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/commerce.message',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
].join(' ');

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RU_NAME;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!clientId || !ruName) {
    return NextResponse.json({ error: 'Missing EBAY_CLIENT_ID or EBAY_RU_NAME' }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: 'code',
    scope: SCOPES,
    prompt: 'login',
  });

  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
}
