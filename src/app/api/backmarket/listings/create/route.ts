import { NextRequest, NextResponse } from 'next/server';
import { isBackmarketConfigured, createBackmarketListing, BackmarketListingPayload } from '@/lib/backmarket-api';

export async function POST(req: NextRequest) {
  if (!isBackmarketConfigured()) {
    return NextResponse.json({ error: 'not_connected', message: 'Back Market credentials not configured' }, { status: 401 });
  }

  const payload: BackmarketListingPayload = await req.json();

  if (!payload.sku || !payload.listing || !payload.price || !payload.quantity || !payload.condition) {
    return NextResponse.json({ error: 'validation', message: 'sku, listing, price, quantity, and condition are required' }, { status: 400 });
  }

  const result = await createBackmarketListing(payload);
  if (!result.success) {
    return NextResponse.json({ error: 'api_error', message: result.message }, { status: result.status });
  }

  return NextResponse.json({ success: true, result: result.result });
}
