import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

// POST { username } — persist the detected seller username (used by feedback
// monitoring). Env EBAY_SELLER_USERNAME still takes precedence where set.
export async function POST(req: Request) {
  const { username } = await req.json() as { username?: string };
  if (!username || !username.trim()) return NextResponse.json({ error: 'username required' }, { status: 400 });
  await getSupabase().from('app_settings').upsert({ key: 'ebay_seller_username', value: username.trim(), updated_at: new Date().toISOString() });
  return NextResponse.json({ success: true });
}

export async function GET() {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', 'ebay_seller_username').single();
  return NextResponse.json({ username: process.env.EBAY_SELLER_USERNAME || data?.value || null });
}
