import { NextRequest, NextResponse } from 'next/server';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function GET(req: NextRequest) {
  console.log('[eBay callback] Route hit, URL:', req.url);

  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://frolicking-macaron-750199.netlify.app';
    console.log('[eBay callback] appUrl:', appUrl, 'code exists:', !!code, 'error:', error);

    if (error || !code) {
      console.log('[eBay callback] Missing code or error present, error:', error, 'code:', code);
      const errorParam = error ? encodeURIComponent(error) : 'no_code';
      return NextResponse.redirect(`${appUrl}/import?ebay_error=${errorParam}`);
    }

    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    const ruName = process.env.EBAY_RU_NAME;

    console.log('[eBay callback] Env vars present:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRuName: !!ruName,
    });

    if (!clientId || !clientSecret || !ruName) {
      console.error('[eBay callback] Missing env vars');
      return NextResponse.redirect(`${appUrl}/import?ebay_error=missing_env_vars`);
    }

    console.log('[eBay callback] clientId prefix:', clientId.slice(0, 12), 'suffix:', clientId.slice(-8));
    console.log('[eBay callback] ruName:', ruName);

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    console.log('[eBay callback] Credentials encoded, fetching token...');

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

    console.log('[eBay callback] Token response status:', res.status);

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

    console.log('[eBay callback] Token received, has refresh_token:', !!data.refresh_token);

    const expiresAt = Date.now() + data.expires_in * 1000;

    // Check for debug mode
    const isDebug = searchParams.get('debug') === '1';

    // Set cookies via response headers (proper way for App Router)
    const redirectUrl = `${appUrl}/import?ebay_connected=1`;

    if (isDebug) {
      // Return JSON in debug mode to see what's happening
      return NextResponse.json({
        success: true,
        redirectUrl,
        cookies: {
          ebay_access_token: 'set',
          ebay_refresh_token: 'set',
          ebay_token_expires_at: 'set',
        },
        tokenPreview: {
          access_token_prefix: data.access_token.slice(0, 20),
          refresh_token_prefix: data.refresh_token.slice(0, 20),
        },
      });
    }

    const response = NextResponse.redirect(redirectUrl);
    response.headers.append('Set-Cookie', serializeCookie('ebay_access_token', data.access_token, data.expires_in));
    response.headers.append('Set-Cookie', serializeCookie('ebay_refresh_token', data.refresh_token, data.refresh_token_expires_in));
    response.headers.append('Set-Cookie', serializeCookie('ebay_token_expires_at', String(expiresAt), data.refresh_token_expires_in));

    console.log('[eBay callback] Cookies set via headers, redirecting to:', redirectUrl);

    return response;
  } catch (err) {
    console.error('[eBay callback] Unexpected error:', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://frolicking-macaron-750199.netlify.app';
    return NextResponse.redirect(`${appUrl}/import?ebay_error=callback_exception`);
  }
}
