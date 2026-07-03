import { NextRequest, NextResponse } from 'next/server';
import { createDPDShipment, validateDpdOutboundServices, DPDOutboundService, DPDShipmentRequest } from '@/lib/dpd-client';

// Books a DPD driver collection from the customer's address back to the warehouse.
// Used for swaps: the replacement is dispatched immediately and DPD collects the
// faulty item from the customer. Collection = customer, delivery = warehouse.
// GB mainland only.

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

function pickNetworkKey(services: DPDOutboundService[]): string {
  const preferred = process.env.DPD_PREFERRED_NETWORK_CODE;
  if (preferred) {
    const match = services.find((s) => s.networkKey === preferred || s.networkCode === preferred);
    if (match) return match.networkKey;
  }
  // Prefer a plain Parcel Next Day service, then any Parcel, then the first offered
  const parcelNextDay = services.find((s) => {
    const sd = (s.service?.serviceDesc ?? s.networkDesc ?? '').toLowerCase();
    const pd = (s.product?.productDesc ?? '').toLowerCase();
    return pd.includes('parcel') && sd.includes('next day');
  });
  const parcel = services.find((s) => (s.product?.productDesc ?? '').toLowerCase().includes('parcel'));
  return (parcelNextDay ?? parcel ?? services[0]).networkKey;
}

interface CollectionCustomer {
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

interface CollectionBody {
  customer: CollectionCustomer;
  weight?: number;
  reference?: string;       // e.g. original sales record number
  collectionDate?: string;  // ISO date; defaults to tomorrow
}

export async function POST(req: NextRequest) {
  if (notConfigured()) {
    return NextResponse.json(
      { error: 'not_configured', message: 'DPD API credentials not set (DPD_API_KEY or DPD_API_USER/PASSWORD, plus DPD_ACCOUNT_NUMBER).' },
      { status: 503 }
    );
  }

  const body = (await req.json()) as CollectionBody;
  const { customer, weight = 1, reference, collectionDate } = body;

  if (!customer?.address1 || !customer?.postcode || !customer?.name) {
    return NextResponse.json({ error: 'invalid_customer', message: 'Customer name, address and postcode are required.' }, { status: 400 });
  }

  const warehousePhone = tel(process.env.DPD_COLLECTION_PHONE) || '01210000000';

  // Customer = collection; warehouse = delivery.
  const collectionAddress = {
    organisation: '',
    street: clean(customer.address1),
    locality: clean(customer.address2),
    town: clean(customer.city),
    county: clean(customer.county),
    postcode: postcode(customer.postcode),
    countryCode: customer.country === 'United Kingdom' ? 'GB' : (customer.country || 'GB'),
  };
  const deliveryAddress = {
    organisation: clean(process.env.DPD_SHIPPER_COMPANY || 'Warehouse'),
    street: clean(process.env.DPD_COLLECTION_ADDRESS1 || ''),
    locality: '',
    town: clean(process.env.DPD_COLLECTION_CITY || ''),
    county: '',
    postcode: postcode(process.env.DPD_COLLECTION_POSTCODE || ''),
    countryCode: 'GB',
  };

  let networkCode: string;
  try {
    const services = await validateDpdOutboundServices({
      collectionPostcode: collectionAddress.postcode,
      collectionTown: collectionAddress.town,
      collectionCountryCode: collectionAddress.countryCode,
      deliveryPostcode: deliveryAddress.postcode,
      deliveryTown: deliveryAddress.town,
      deliveryCountryCode: deliveryAddress.countryCode,
      totalWeight: Math.max(0.1, weight),
      numberOfParcels: 1,
    });
    if (!services.length) {
      return NextResponse.json(
        { error: 'no_services', message: 'DPD offers no collection service between the customer address and the warehouse.' },
        { status: 422 }
      );
    }
    networkCode = pickNetworkKey(services);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'services_failed', message: msg }, { status: 502 });
  }

  // DPD only accepts working collection days and rejects others with code 103
  // ("The specified shipment date is unavailable"), e.g. weekends or past the
  // same-day cutoff. Build candidate weekdays and retry until one is accepted.
  const candidateDates: string[] = [];
  const base = collectionDate ? new Date(collectionDate) : new Date();
  for (let offset = 0; candidateDates.length < 4 && offset < 10; offset++) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // no weekend collections
    const pad = (n: number) => String(n).padStart(2, '0');
    candidateDates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`);
  }

  const buildPayload = (shipmentDate: string) => ({
    shipmentDate,
    outboundConsignment: {
      collectionDetails: {
        contactDetails: { contactName: clean(customer.name), telephone: tel(customer.phone) || warehousePhone },
        address: collectionAddress,
      },
      deliveryDetails: {
        contactDetails: { contactName: clean(process.env.DPD_SHIPPER_NAME || 'Returns Dept'), telephone: warehousePhone },
        address: deliveryAddress,
        notificationDetails: {
          mobile: tel(customer.phone),
          email: customer.email?.trim().slice(0, 100) || '',
        },
      },
      numberOfParcels: 1,
      totalWeight: Math.max(0.1, weight),
      currency: 'GBP',
      networkCode,
      shippingRef1: clean(reference || 'SWAP', 25),
      shippingRef2: '',
      shippingRef3: '',
      deliveryInstructions: '',
    },
  });

  const dateUnavailable = (msg: string) =>
    msg.includes('"fieldPath":"shipmentDate"') || (msg.includes('"code":103') && msg.toLowerCase().includes('shipment date'));

  let lastError = '';
  for (const shipmentDate of candidateDates) {
    try {
      const created = await createDPDShipment(buildPayload(shipmentDate) as unknown as DPDShipmentRequest);
      const consignment = created.data?.consignments?.[0];
      if (!consignment) {
        return NextResponse.json({ error: 'no_consignment', message: 'DPD did not return a consignment for the collection.' }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        shipmentId: created.data?.shipmentId,
        consignmentNumber: consignment.consignmentNumber,
        parcelNumber: consignment.parcelNumber?.[0],
        trackingNumber: consignment.parcelNumber?.[0] ?? consignment.consignmentNumber,
        collectionDate: shipmentDate,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('"code":101') && msg.toLowerCase().includes('sample')) {
        return NextResponse.json(
          { error: 'sandbox_only', message: 'DPD sandbox only accepts its example payload, so real collections can only be booked with DPD_ENV=live. The integration reached DPD correctly.' },
          { status: 422 }
        );
      }
      if (dateUnavailable(msg)) {
        console.log(`[DPD collection] date ${shipmentDate} unavailable, trying next working day`);
        lastError = msg;
        continue;
      }
      return NextResponse.json({ error: 'create_failed', message: msg }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: 'no_available_date', message: `DPD rejected every collection date tried (${candidateDates.join(', ')}). ${lastError}` },
    { status: 502 }
  );
}
