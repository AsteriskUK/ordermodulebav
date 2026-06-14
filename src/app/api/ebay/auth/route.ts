import { NextResponse } from 'next/server';

const SANDBOX_AUTH_URL = 'https://auth.sandbox.ebay.com/oauth2/authorize';
const PROD_AUTH_URL = 'https://auth.ebay.com/oauth2/authorize';

const SCOPES = [
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ');

export async function GET() {
  const isSandbox = process.env.EBAY_ENV === 'SANDBOX';
  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RU_NAME;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (!clientId || !ruName) {
    return NextResponse.json({ error: 'Missing EBAY_CLIENT_ID or EBAY_RU_NAME' }, { status: 500 });
  }

  const authUrl = isSandbox ? SANDBOX_AUTH_URL : PROD_AUTH_URL;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: 'code',
    scope: SCOPES,
    prompt: 'login',
  });

  return NextResponse.redirect(`${authUrl}?${params.toString()}`);
}
