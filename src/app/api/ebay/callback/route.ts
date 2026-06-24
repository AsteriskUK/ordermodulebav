import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
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
      const errorParam = error ? encodeURIComponent(error) : 'no_code';
      return NextResponse.redirect(`${appUrl}/import?ebay_error=${errorParam}`);
    }

    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;
    const ruName = process.env.EBAY_RU_NAME;

    if (!clientId || !clientSecret || !ruName) {
      console.error('[eBay callback] Missing env vars');
      return NextResponse.redirect(`${appUrl}/import?ebay_error=missing_env_vars`);
    }

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

    console.log('[eBay callback] Token received, storing in Supabase...');

    // Store tokens in Supabase so they survive across requests without relying on cookies
    const supabase = getSupabase();
    const expiresAt = Date.now() + data.expires_in * 1000;
    const { error: dbError } = await supabase.from('app_settings').upsert([
      { key: 'ebay_access_token', value: data.access_token, updated_at: new Date().toISOString() },
      { key: 'ebay_refresh_token', value: data.refresh_token, updated_at: new Date().toISOString() },
      { key: 'ebay_token_expires_at', value: String(expiresAt), updated_at: new Date().toISOString() },
    ]);

    if (dbError) {
      console.error('[eBay callback] Supabase store error:', dbError);
      return NextResponse.redirect(`${appUrl}/import?ebay_error=db_store_failed`);
    }

    console.log('[eBay callback] Tokens stored in Supabase, redirecting to import');
    return NextResponse.redirect(`${appUrl}/import?ebay_connected=1`);
  } catch (err) {
    console.error('[eBay callback] Unexpected error:', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://frolicking-macaron-750199.netlify.app';
    return NextResponse.redirect(`${appUrl}/import?ebay_error=callback_exception`);
  }
}
