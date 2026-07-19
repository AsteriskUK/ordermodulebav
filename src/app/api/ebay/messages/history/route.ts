import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';

export async function GET() {
  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('ebay_messages')
    .select('id, order_id, buyer_username, buyer_name, item_title, contact_reason, message_text, sent_by_name, sent_at, status')
    .order('sent_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json([], { status: 200 });
  return NextResponse.json(data ?? []);
}
