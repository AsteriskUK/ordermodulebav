import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';

function getSupabase() {
  return getServiceClient();
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
