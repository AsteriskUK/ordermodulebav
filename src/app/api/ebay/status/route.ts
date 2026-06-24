import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET() {
  // Env var takes priority (manual override)
  if (process.env.EBAY_REFRESH_TOKEN) {
    return NextResponse.json({ connected: true, source: 'env' });
  }

  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'ebay_refresh_token')
      .single();

    return NextResponse.json({ connected: !!data?.value, source: 'db' });
  } catch {
    return NextResponse.json({ connected: false, source: 'db' });
  }
}
