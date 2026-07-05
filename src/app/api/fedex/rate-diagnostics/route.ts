import { NextRequest, NextResponse } from 'next/server';
import { Order } from '@/lib/types';
import { getFedExToken, getFedExRate } from '@/lib/fedex-client';
import { buildFedExShipmentPayload } from '@/lib/fedex-payload';

// GET /api/fedex/rate-diagnostics
//
// One-shot health check for FedEx live rating. Reports which env is active and
// which credentials are present (booleans only — never the values), then tries to
// authenticate and pull a live rate quote for a sample shipment. Use this to
// confirm production works right after flipping FEDEX_ENV=production and pasting
// production keys — no order data or booking involved (a rate quote is read-only).
//
// Optional query params to shape the sample: ?postcode=EC1A1BB&country=United%20Kingdom&boxes=1&type=next_day

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const postcode = url.searchParams.get('postcode') || 'EC1A 1BB';
  const country = url.searchParams.get('country') || 'United Kingdom';
  const boxes = Math.max(1, Number(url.searchParams.get('boxes')) || 1);
  const deliveryType = (url.searchParams.get('type') || 'standard') as Order['deliveryType'];

  const config = {
    env: process.env.FEDEX_ENV === 'production' ? 'production' : 'sandbox',
    clientId: !!process.env.FEDEX_CLIENT_ID,
    clientSecret: !!process.env.FEDEX_CLIENT_SECRET,
    accountNumber: !!process.env.FEDEX_ACCOUNT_NUMBER,
    shipperPostcode: !!process.env.FEDEX_SHIPPER_POSTCODE,
    defaultParcelKg: Number(process.env.FEDEX_DEFAULT_PARCEL_KG) || 1,
  };

  // Auth check — surfaces bad keys / wrong-env credentials clearly.
  try {
    await getFedExToken();
  } catch (e) {
    return NextResponse.json({
      config,
      auth: { ok: false, error: e instanceof Error ? e.message : String(e) },
      hint: 'Auth failed. Check that the keys match FEDEX_ENV (sandbox vs production keys are different) and that the project is approved.',
    });
  }

  // Sample order — only the fields buildFedExShipmentPayload reads are populated.
  const sampleOrder = {
    id: 'diag',
    salesRecordNumber: 'DIAG-1',
    postToName: 'Rate Test',
    buyerUsername: 'ratetest',
    buyerEmail: '',
    postToPhone: '02000000000',
    postToAddress1: '1 Test Street',
    postToAddress2: '',
    postToCity: country === 'United Kingdom' ? 'London' : 'City',
    postToCounty: '',
    postToPostcode: postcode,
    postToCountry: country,
    numberOfBoxes: boxes,
    deliveryType,
  } as unknown as Order;

  const shipDate = new Date().toISOString().slice(0, 10);
  const payload = buildFedExShipmentPayload(sampleOrder, shipDate);

  try {
    const rate = await getFedExRate(payload);
    return NextResponse.json({
      config,
      auth: { ok: true },
      sample: { postcode, country, boxes, serviceType: payload.serviceType },
      rate: rate
        ? { ok: true, amount: rate.amount, currency: rate.currency }
        : { ok: false, error: 'Authenticated, but FedEx returned no usable rate. On sandbox this is expected — the Rate API needs production + a Rate-enabled project.' },
    });
  } catch (e) {
    return NextResponse.json({
      config,
      auth: { ok: true },
      sample: { postcode, country, boxes, serviceType: payload.serviceType },
      rate: { ok: false, error: e instanceof Error ? e.message : String(e) },
      hint: 'Auth worked but the rate call failed. Most often the "Rates and Transit Times" API is not added to this FedEx project, or you are on sandbox.',
    });
  }
}
