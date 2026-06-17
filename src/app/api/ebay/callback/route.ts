import { NextRequest, NextResponse } from 'next/server';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ebaypicking.netlify.app';

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/import?ebay_error=${error || 'no_code'}`);
  }

  const clientId = process.env.EBAY_CLIENT_ID!;
  const clientSecret = process.env.EBAY_CLIENT_SECRET!;
  const ruName = process.env.EBAY_RU_NAME!;

  console.log('[eBay callback] clientId prefix:', clientId.slice(0, 12), 'suffix:', clientId.slice(-8));
  console.log('[eBay callback] ruName:', ruName);

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
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
    console.error('[eBay callback] Token exchange failed:', res.status, body);
    return NextResponse.redirect(`${appUrl}/import?ebay_error=token_exchange_failed`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    refresh_token_expires_in: number;
  };

  const expiresAt = Date.now() + data.expires_in * 1000;

  // Set cookies via response headers (proper way for App Router)
  const response = NextResponse.redirect(`${appUrl}/import?ebay_connected=1`);
  response.headers.append('Set-Cookie', serializeCookie('ebay_access_token', data.access_token, data.expires_in));
  response.headers.append('Set-Cookie', serializeCookie('ebay_refresh_token', data.refresh_token, data.refresh_token_expires_in));
  response.headers.append('Set-Cookie', serializeCookie('ebay_token_expires_at', String(expiresAt), data.refresh_token_expires_in));

  console.log('[eBay callback] Cookies set via headers, redirecting to import');

  return response;
}
