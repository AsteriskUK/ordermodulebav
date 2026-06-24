import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from('ebay_messages')
    .select('id, order_id, buyer_username, buyer_name, item_title, contact_reason, message_text, sent_by_name, sent_at, status')
    .order('sent_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json([], { status: 200 });
  return NextResponse.json(data ?? []);
}
