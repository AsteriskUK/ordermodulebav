import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';

function getSupabase() {
  return getServiceClient();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const search = searchParams.get('search') || undefined;
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)));
  const offset = Math.max(0, Number(searchParams.get('offset') ?? 0));

  const supabase = getSupabase();
  let query = supabase.from('ebay_live_listings').select('*', { count: 'exact' });

  if (status) {
    query = query.eq('listing_status', status);
  }
  if (search) {
    query = query.or(`title.ilike.%${search}%,sku.ilike.%${search}%`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[eBay live listings] fetch error', error.message);
    return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    listings: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
