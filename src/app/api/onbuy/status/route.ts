import { NextResponse } from 'next/server';
import { isOnBuyConfigured } from '@/lib/onbuy-client';

export async function GET() {
  return NextResponse.json({ connected: isOnBuyConfigured() });
}
