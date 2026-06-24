import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const result: Record<string, unknown> = {
    env: {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      hasEbayClientId: !!process.env.EBAY_CLIENT_ID,
      hasEbayClientSecret: !!process.env.EBAY_CLIENT_SECRET,
      hasEbayRuName: !!process.env.EBAY_RU_NAME,
      ebayRuName: process.env.EBAY_RU_NAME,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
    },
  };

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ ...result, error: 'Missing Supabase env vars' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if table exists and what's in it
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, updated_at')
      .in('key', ['ebay_access_token', 'ebay_refresh_token', 'ebay_token_expires_at']);

    result.supabase = {
      error: error?.message ?? null,
      rows: data?.map(r => ({ key: r.key, updated_at: r.updated_at })) ?? [],
      hasRefreshToken: data?.some(r => r.key === 'ebay_refresh_token') ?? false,
      hasAccessToken: data?.some(r => r.key === 'ebay_access_token') ?? false,
    };

    // Try a test write
    const { error: writeError } = await supabase
      .from('app_settings')
      .upsert({ key: '_debug_test', value: 'ok', updated_at: new Date().toISOString() });

    result.writeTest = { error: writeError?.message ?? null, success: !writeError };
  } catch (e) {
    result.supabase = { error: String(e) };
  }

  return NextResponse.json(result);
}
