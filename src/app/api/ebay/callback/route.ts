import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const SANDBOX_TOKEN_URL = 'https://api.sandbox.ebay.com/identity/v1/oauth2/token';
const PROD_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}/import?ebay_error=${error || 'no_code'}`);
  }

  const isSandbox = process.env.EBAY_ENV === 'SANDBOX';
  const clientId = process.env.EBAY_CLIENT_ID!;
  const clientSecret = process.env.EBAY_CLIENT_SECRET!;
  const ruName = process.env.EBAY_RU_NAME!;
  const tokenUrl = isSandbox ? SANDBOX_TOKEN_URL : PROD_TOKEN_URL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ruName,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[eBay callback] Token exchange failed:', body);
    return NextResponse.redirect(`${appUrl}/import?ebay_error=token_exchange_failed`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
  };

  const cookieStore = await cookies();
  const expiresAt = Date.now() + data.expires_in * 1000;
  const refreshExpiresAt = Date.now() + data.refresh_token_expires_in * 1000;

  cookieStore.set('ebay_access_token', data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: data.expires_in,
    path: '/',
  });
  cookieStore.set('ebay_refresh_token', data.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: data.refresh_token_expires_in,
    path: '/',
  });
  cookieStore.set('ebay_token_expires_at', String(expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: data.refresh_token_expires_in,
    path: '/',
  });

  return NextResponse.redirect(`${appUrl}/import?ebay_connected=1`);
}
