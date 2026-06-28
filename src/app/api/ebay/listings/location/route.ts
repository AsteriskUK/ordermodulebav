import { NextRequest, NextResponse } from 'next/server';
import { getEbayAccessToken, EBAY_BASE_URL, EBAY_MARKETPLACE_ID } from '@/lib/ebay-client';

export async function GET() {
  const token = await getEbayAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const res = await fetch(`${EBAY_BASE_URL}/sell/inventory/v1/location`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: 'ebay_api_error', message: body }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json({ locations: data.locations ?? [] });
}

export async function POST(req: NextRequest) {
  const token = await getEbayAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const body = await req.json() as {
    merchantLocationKey: string;
    name: string;
    postalCode: string;
    country: string;
  };

  const res = await fetch(
    `${EBAY_BASE_URL}/sell/inventory/v1/location/${encodeURIComponent(body.merchantLocationKey)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
      },
      body: JSON.stringify({
        name: body.name,
        merchantLocationStatus: 'ENABLED',
        locationTypes: ['WAREHOUSE'],
        location: {
          address: {
            postalCode: body.postalCode,
            country: body.country,
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    return NextResponse.json({ error: 'ebay_api_error', message: errBody }, { status: res.status });
  }

  return NextResponse.json({ success: true, merchantLocationKey: body.merchantLocationKey });
}
