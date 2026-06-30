import { NextRequest, NextResponse } from 'next/server';
import { createDPDReturn, getDPDReturnLabel, getDPDReturnBarcode, DPDReturnRequest } from '@/lib/dpd-client';

// Uses DPD's dedicated Returns API: create the return, then fetch a printable
// label and/or a 2D barcode, optionally emailing them to the customer. The
// returnee drops the parcel at a DPD Pickup location. GB mainland only.

function notConfigured(): boolean {
  const hasApiKey = !!process.env.DPD_API_KEY;
  const hasUsernameAuth = !!process.env.DPD_API_USER && !!process.env.DPD_API_PASSWORD;
  const hasAccountNumber = !!process.env.DPD_ACCOUNT_NUMBER;
  return (!hasApiKey && !hasUsernameAuth) || !hasAccountNumber;
}

const clean = (v: string | undefined, n = 30) => (v || '').trim().slice(0, n);
const postcode = (v: string | undefined) => (v || '').trim().slice(0, 8);

// DPD requires telephone to match ^\+?\d{7,15}$
function tel(v: string | undefined): string {
  const raw = (v || '').trim();
  const out = (raw.startsWith('+') ? '+' : '') + raw.replace(/\D/g, '');
  return /^\+?\d{7,15}$/.test(out) ? out : '';
}

interface ReturnCustomer {
  name: string;
  phone?: string;
  email?: string;
  address1: string;
  address2?: string;
  city: string;
  county?: string;
  postcode: string;
  country?: string;
}

interface ReturnBody {
  customer: ReturnCustomer;
  weight?: number;
  reference?: string;       // e.g. original sales record number
  sendEmail?: boolean;      // email label/barcode to the customer
  wantBarcode?: boolean;    // also fetch a 2D barcode
}

export async function POST(req: NextRequest) {
  if (notConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'DPD API credentials not set (DPD_API_KEY or DPD_API_USER/PASSWORD, plus DPD_ACCOUNT_NUMBER).' },
      { status: 503 }
    );
  }

  const body = (await req.json()) as ReturnBody;
  const { customer, weight = 1, reference, sendEmail = false, wantBarcode = false } = body;

  if (!customer?.address1 || !customer?.postcode || !customer?.name) {
    return NextResponse.json({ error: 'invalid_customer', message: 'Customer name, address and postcode are required.' }, { status: 400 });
  }

  const warehousePhone = tel(process.env.DPD_COLLECTION_PHONE) || '01210000000';

  // Returnee (customer) = collection; return destination (warehouse) = delivery.
  const payload: DPDReturnRequest = {
    outboundConsignment: {
      collectionDetails: {
        contactDetails: { contactName: clean(customer.name), telephone: tel(customer.phone) || warehousePhone, email: customer.email?.trim().slice(0, 100) },
        address: {
          organisation: '',
          street: clean(customer.address1),
          locality: clean(customer.address2),
          town: clean(customer.city),
          county: clean(customer.county),
          postcode: postcode(customer.postcode),
          countryCode: customer.country === 'United Kingdom' ? 'GB' : (customer.country || 'GB'),
        },
      },
      deliveryDetails: {
        contactDetails: { contactName: clean(process.env.DPD_SHIPPER_NAME || 'Returns Dept'), telephone: warehousePhone },
        address: {
          organisation: clean(process.env.DPD_SHIPPER_COMPANY || 'Warehouse'),
          street: clean(process.env.DPD_COLLECTION_ADDRESS1 || ''),
          locality: '',
          town: clean(process.env.DPD_COLLECTION_CITY || ''),
          county: '',
          postcode: postcode(process.env.DPD_COLLECTION_POSTCODE || ''),
          countryCode: 'GB',
        },
      },
      numberOfParcels: 1,
      totalWeight: Math.max(0.1, weight),
      shipmentDate: new Date().toISOString().slice(0, 19),
      shippingRef1: clean(reference || 'RETURN', 25),
    },
  };

  // 1. Create the return
  let created;
  try {
    created = await createDPDReturn(payload, sendEmail);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // DPD's sandbox only accepts its own example payload (code 101). Surface a clear
    // message so testers know this works only against the live environment.
    if (msg.includes('"code":101') && msg.toLowerCase().includes('sample')) {
      return NextResponse.json(
        { error: 'sandbox_only', message: 'DPD sandbox only accepts its example payload, so real return labels can only be issued with DPD_ENV=live. The integration reached DPD correctly.' },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: 'create_failed', message: msg }, { status: 502 });
  }

  const consignment = created.data?.consignments?.[0];
  const shipmentId = created.data?.shipmentId;
  if (!shipmentId || !consignment) {
    return NextResponse.json({ error: 'no_consignment', message: 'DPD did not return a shipmentId for the return.' }, { status: 502 });
  }
  const trackingNumber = consignment.parcelNumber?.[0] ?? consignment.consignmentNumber;

  // 2. Fetch the printable label (HTML)
  let labelHtml = '';
  try {
    labelHtml = await getDPDReturnLabel(shipmentId, sendEmail);
  } catch (e) {
    console.error('[DPD return] label fetch failed:', e);
  }

  // 3. Optionally fetch the 2D barcode
  let barcodes: { parcelNumber: string; imageData: string; imageFormat: string }[] = [];
  if (wantBarcode) {
    try {
      barcodes = await getDPDReturnBarcode(shipmentId, sendEmail);
    } catch (e) {
      console.error('[DPD return] barcode fetch failed:', e);
    }
  }

  return NextResponse.json({
    ok: true,
    shipmentId,
    consignmentNumber: consignment.consignmentNumber,
    parcelNumber: consignment.parcelNumber?.[0],
    trackingNumber,
    labelHtml,
    barcodes,
    emailed: sendEmail,
  });
}
