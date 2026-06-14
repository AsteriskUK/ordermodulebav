import { NextRequest, NextResponse } from 'next/server';
import { getFedExToken } from '@/lib/fedex-client';

async function postcodeIoFallback(postcode: string) {
  const clean = postcode.replace(/\s/g, '').toUpperCase();
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
  if (!res.ok) return [];
  const data = await res.json();
  const r = data.result;
  if (!r) return [];
  return [{
    address1: '',
    address2: '',
    city: r.admin_district || r.parish || '',
    county: r.admin_county || r.admin_district || '',
    postcode: r.postcode ?? postcode,
    country: 'United Kingdom',
    source: 'postcodes.io',
  }];
}

export async function POST(req: NextRequest) {
  const { postcode, address1 } = await req.json() as { postcode: string; address1?: string };
  if (!postcode?.trim()) {
    return NextResponse.json({ error: 'postcode required' }, { status: 400 });
  }

  const fedexConfigured = !!(process.env.FEDEX_CLIENT_ID && process.env.FEDEX_CLIENT_SECRET);

  if (fedexConfigured) {
    try {
      const token = await getFedExToken();
      const base = process.env.FEDEX_ENV === 'production'
        ? 'https://apis.fedex.com'
        : 'https://apis-sandbox.fedex.com';

      const body = {
        addressesToValidate: [{
          address: {
            streetLines: address1 ? [address1] : undefined,
            postalCode: postcode.trim().toUpperCase(),
            countryCode: 'GB',
          },
        }],
      };

      const res = await fetch(`${base}/address/v1/addresses/resolve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-locale': 'en_GB',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      console.log(`[address-search] FedEx status: ${res.status}`, JSON.stringify(data).slice(0, 500));

      if (res.ok) {
        const resolved = data?.output?.resolvedAddresses ?? [];
        if (resolved.length > 0) {
          const suggestions = resolved.map((r: {
            streetLinesToken?: string[];
            city?: string;
            stateOrProvinceCode?: string;
            postalCode?: string;
            countryCode?: string;
          }) => ({
            address1: r.streetLinesToken?.[0] ?? '',
            address2: r.streetLinesToken?.[1] ?? '',
            city: r.city ?? '',
            county: r.stateOrProvinceCode ?? '',
            postcode: r.postalCode ?? postcode,
            country: r.countryCode === 'GB' ? 'United Kingdom' : (r.countryCode ?? 'United Kingdom'),
            source: 'fedex',
          }));
          return NextResponse.json({ suggestions });
        }
        console.warn(`[address-search] FedEx ok but no resolvedAddresses, falling back`);
      } else {
        const errMsg = data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
        console.warn(`[address-search] FedEx failed (${errMsg}), falling back to postcodes.io`);
      }
    } catch (e) {
      console.warn(`[address-search] FedEx exception (${e instanceof Error ? e.message : e}), falling back to postcodes.io`);
    }
  }

  // Fallback: postcodes.io always works for UK
  try {
    const suggestions = await postcodeIoFallback(postcode);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
