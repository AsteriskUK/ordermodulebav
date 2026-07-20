import { NextRequest, NextResponse } from 'next/server';
import { getSettings, resolveSetting, asString } from '@/lib/settings';
import { createDPDShipment, getDPDLabels, validateDpdOutboundServices, DPDOutboundService, DPDLabelResult } from '@/lib/dpd-client';
import { Order } from '@/lib/types';

function notConfigured() {
  // Check for API key authentication OR username/password authentication
  const hasApiKey = !!process.env.DPD_API_KEY;
  const hasUsernameAuth = !!process.env.DPD_API_USER && !!process.env.DPD_API_PASSWORD;
  const hasAccountNumber = !!process.env.DPD_ACCOUNT_NUMBER;
  
  return (!hasApiKey && !hasUsernameAuth) || !hasAccountNumber;
}

function sanitizePhone(phone: string): string {
  return (phone || '').replace(/\s+/g, '').slice(0, 15);
}

function sanitizePostcode(postcode: string): string {
  return (postcode || '').trim().slice(0, 8);
}

function sanitizeAddressLine(value: string, maxLength = 30): string {
  return (value || '').trim().slice(0, maxLength);
}

function sanitizeReference(value: string, maxLength = 30): string {
  return (value || '').trim().slice(0, maxLength);
}

function sanitizeEmail(value: string, maxLength = 100): string {
  return (value || '').trim().slice(0, maxLength);
}

function sanitizeInstructions(value: string, maxLength = 100): string {
  return (value || '').trim().slice(0, maxLength);
}

// DPD docs example collection address for diagnostic testing
const DPD_DOCS_COLLECTION = {
  contactDetails: { contactName: 'My Contact', telephone: '01215002500' },
  address: {
    organisation: 'DPD Group Ltd',
    street: 'Roebuck Lane',
    locality: 'Smethwick',
    town: 'Birmingham',
    county: 'West Midlands',
    postcode: 'B66 1BY',
    countryCode: 'GB',
  },
};

// DPD docs example delivery address for full diagnostic testing
const DPD_DOCS_DELIVERY = {
  contactDetails: { contactName: 'Test Recipient', telephone: '02012345678' },
  address: {
    organisation: '',
    street: '1 Test Street',
    locality: '',
    town: 'London',
    county: '',
    postcode: 'EC1A 1BB',
    countryCode: 'GB',
  },
  notificationDetails: { mobile: '07700900000', email: 'test@example.com' },
};

// Map DPDService values to fragments of DPD's serviceDesc for matching
const SERVICE_DESC_MAP: Record<string, string[]> = {
  next_day:         ['next day'],
  by_1030:          ['10:30', 'by 10:30'],
  by_12:            ['by 12'],
  saturday:         ['saturday'],
  saturday_by_1030: ['saturday by 10:30', 'sat by 10:30'],
  saturday_by_12:   ['saturday by 12', 'sat by 12'],
  sunday:           ['sunday'],
  sunday_by_12:     ['sunday by 12'],
};

function selectNetworkKey(services: DPDOutboundService[], service: string): string {
  // 1. Env override takes highest priority
  const preferred = process.env.DPD_PREFERRED_NETWORK_CODE;
  if (preferred) {
    const match = services.find(
      (s) => s.networkKey === preferred || s.networkCode === preferred
    );
    if (match) {
      console.log('[DPD] Selected networkKey (env preferred):', match.networkKey, '|', match.networkDesc);
      return match.networkKey;
    }
    console.warn('[DPD] DPD_PREFERRED_NETWORK_CODE', preferred, 'not found in available services, ignoring');
  }

  // 2. Match by DPDService → serviceDesc, preferring Parcel product over Expak/Freight
  const descs = SERVICE_DESC_MAP[service] ?? SERVICE_DESC_MAP['next_day'];
  const candidates = services.filter((s) => {
    const sd = (s.service?.serviceDesc ?? s.networkDesc ?? '').toLowerCase();
    return descs.some((d) => sd.includes(d));
  });

  if (candidates.length > 0) {
    // Prefer "Parcel" product type (productDesc contains 'parcel')
    const parcel = candidates.find((s) =>
      (s.product?.productDesc ?? '').toLowerCase().includes('parcel')
    );
    const selected = parcel ?? candidates[0];
    console.log('[DPD] Selected networkKey (service match):', selected.networkKey, '|', selected.networkDesc);
    return selected.networkKey;
  }

  // 3. Fallback: first Parcel Next Day service available
  const parcelNextDay = services.find((s) => {
    const sd = (s.service?.serviceDesc ?? '').toLowerCase();
    const pd = (s.product?.productDesc ?? '').toLowerCase();
    return pd.includes('parcel') && sd.includes('next day');
  });
  if (parcelNextDay) {
    console.log('[DPD] Selected networkKey (fallback parcel next day):', parcelNextDay.networkKey, '|', parcelNextDay.networkDesc);
    return parcelNextDay.networkKey;
  }

  // 4. Last resort: first service
  const first = services[0];
  console.log('[DPD] Selected networkKey (last resort first):', first.networkKey, '|', first.networkDesc);
  return first.networkKey;
}

async function orderToPayload(order: Order, service: string): Promise<any> {
  const numberOfBoxes = order.numberOfBoxes ?? 1;

  const useDocsCollection = process.env.DPD_USE_DOCS_TEST_ADDRESS === 'true';
  const useFullDocsAddresses = process.env.DPD_USE_FULL_DOCS_TEST_ADDRESSES === 'true';
  const accountNumber = process.env.DPD_ACCOUNT_NUMBER;

  const shipmentDate = new Date().toISOString().slice(0, 19);

  console.log('[DPD] --- Shipment Context ---');
  console.log('[DPD] Environment:', process.env.DPD_ENV);
  console.log('[DPD] Account number last 3:', accountNumber ? accountNumber.slice(-3) : '(not set)');
  console.log('[DPD] shipmentDate:', shipmentDate);
  console.log('[DPD] Diagnostic mode - docs collection address:', useDocsCollection || useFullDocsAddresses);
  console.log('[DPD] Diagnostic mode - docs delivery address:', useFullDocsAddresses);

  // Collection address comes from Settings → Business when configured, falling
  // back to the DPD_COLLECTION_* env vars so existing deployments keep working.
  const bs = await getSettings();
  const setOr = (key: string, envValue: string | undefined) =>
    asString(resolveSetting(bs, key)) || envValue || '';

  const collectionAddress = (useDocsCollection || useFullDocsAddresses)
    ? DPD_DOCS_COLLECTION.address
    : {
        organisation: '',
        street: sanitizeAddressLine(setOr('business.address1', process.env.DPD_COLLECTION_ADDRESS1)),
        locality: sanitizeAddressLine(asString(resolveSetting(bs, 'business.address2'))),
        town: sanitizeAddressLine(setOr('business.city', process.env.DPD_COLLECTION_CITY)),
        county: sanitizeAddressLine(asString(resolveSetting(bs, 'business.county'))),
        postcode: sanitizePostcode(setOr('business.postcode', process.env.DPD_COLLECTION_POSTCODE)),
        countryCode: 'GB',
      };

  const deliveryAddress = useFullDocsAddresses
    ? DPD_DOCS_DELIVERY.address
    : {
        organisation: '',
        street: sanitizeAddressLine(order.postToAddress1),
        locality: sanitizeAddressLine((order.postToAddress2 || '').replace(/ebay[a-z0-9]+/gi, '').trim()),
        town: sanitizeAddressLine(order.postToCity),
        county: sanitizeAddressLine(order.postToCounty || ''),
        postcode: sanitizePostcode(order.postToPostcode),
        countryCode: order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
      };

  console.log('[DPD] Collection postcode:', collectionAddress.postcode);
  console.log('[DPD] Delivery postcode:', deliveryAddress.postcode);

  // Step 1: validate outbound services to get the correct networkKey
  const services = await validateDpdOutboundServices({
    collectionPostcode: collectionAddress.postcode,
    collectionTown: collectionAddress.town,
    collectionCountryCode: collectionAddress.countryCode,
    deliveryPostcode: deliveryAddress.postcode,
    deliveryTown: deliveryAddress.town,
    deliveryCounty: deliveryAddress.county,
    deliveryCountryCode: deliveryAddress.countryCode,
    totalWeight: numberOfBoxes,
    numberOfParcels: numberOfBoxes,
  });

  if (!services.length) {
    throw new Error(
      'DPD returned no outbound services for this collection/delivery address, weight and parcel count. Cannot create shipment.'
    );
  }

  const networkCode = selectNetworkKey(services, service);
  console.log('[DPD] Selected networkKey:', networkCode);

  const collectionDetails = (useDocsCollection || useFullDocsAddresses)
    ? DPD_DOCS_COLLECTION
    : {
        contactDetails: {
          contactName: sanitizeAddressLine('Warehouse'),
          telephone: sanitizePhone(setOr('business.supportPhone', process.env.DPD_COLLECTION_PHONE)),
        },
        address: collectionAddress,
      };

  const deliveryDetails = useFullDocsAddresses
    ? DPD_DOCS_DELIVERY
    : {
        contactDetails: {
          contactName: sanitizeAddressLine(order.postToName),
          telephone: sanitizePhone(order.postToPhone || ''),
        },
        address: deliveryAddress,
        notificationDetails: {
          mobile: sanitizePhone(order.postToPhone || ''),
          email: sanitizeEmail(order.buyerEmail || ''),
        },
      };

  // One parcel per box, so DPD mints a parcel number (and label) for each.
  // Without an explicit parcels array DPD only ever returns a single label,
  // regardless of numberOfParcels.
  const perParcelWeight = 1;
  const parcels = Array.from({ length: numberOfBoxes }, () => ({ weight: perParcelWeight }));

  const payload = {
    shipmentDate,
    outboundConsignment: {
      collectionDetails,
      deliveryDetails,
      liability: order.extendedLiability ?? false,
      numberOfParcels: numberOfBoxes,
      totalWeight: numberOfBoxes * perParcelWeight,
      parcels,
      currency: 'GBP',
      networkCode,
      shippingRef1: sanitizeReference(order.salesRecordNumber),
      shippingRef2: '',
      shippingRef3: '',
      deliveryInstructions: sanitizeInstructions(''),
    },
  };

  console.log('[DPD] Final payload:', JSON.stringify(payload, null, 2));
  return payload;
}

export async function POST(req: NextRequest) {
  console.log('[DPD API] Checking configuration...');
  console.log('[DPD API] DPD_API_KEY exists:', !!process.env.DPD_API_KEY);
  console.log('[DPD API] DPD_API_USER exists:', !!process.env.DPD_API_USER);
  console.log('[DPD API] DPD_ACCOUNT_NUMBER exists:', !!process.env.DPD_ACCOUNT_NUMBER);
  console.log('[DPD API] DPD_ENV:', process.env.DPD_ENV);
  
  if (notConfigured()) {
    console.log('[DPD API] Configuration check FAILED');
    return NextResponse.json(
      { error: 'not_configured', message: 'DPD API credentials not set. Fill in DPD_API_KEY (for sandbox) or DPD_API_USER + DPD_API_PASSWORD (for production), and DPD_ACCOUNT_NUMBER in .env.local.' },
      { status: 503 }
    );
  }
  console.log('[DPD API] Configuration check PASSED');

  const body = await req.json() as { orders: Order[]; service?: string };
  const { orders, service = 'next_day' } = body;

  if (!orders?.length) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 });
  }

  type ShipResult = { ok: true; orderId: string; salesRecordNumber: string; consignmentNumber?: string; parcelNumber?: string; labelPdfs?: string[]; labelHtmls?: string[] } | { ok: false; orderId: string; salesRecordNumber: string; error: string };

  const results: ShipResult[] = await Promise.all(
    orders.map(async (order): Promise<ShipResult> => {
      try {
        console.log(`[DPD API] Processing order ${order.salesRecordNumber}...`);
        const orderService = order.deliveryService || service || 'next_day';
        console.log(`[DPD API] Order ${order.salesRecordNumber} using service: ${orderService} (deliveryService=${order.deliveryService}, bodyService=${service})`);
        const payload = await orderToPayload(order, orderService);
        console.log(`[DPD API] Payload for ${order.salesRecordNumber}:`, JSON.stringify(payload, null, 2));
        const res = await createDPDShipment(payload);
        console.log(`[DPD API] Response for ${order.salesRecordNumber}:`, JSON.stringify(res, null, 2));
        const consignment = res.data?.consignments?.[0];
        if (!consignment) {
          console.error(`[DPD API] No consignment data for ${order.salesRecordNumber}`);
          return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: 'No consignment data in response' };
        }
        
        // Fetch labels using shipmentId from response
        let labelPdfs: string[] | undefined;
        let labelHtmls: string[] | undefined;
        const shipmentId = res.data?.shipmentId;
        if (shipmentId) {
          try {
            console.log(`[DPD API] Fetching labels for shipment ${shipmentId}...`);
            const labelResults: DPDLabelResult[] = await getDPDLabels(shipmentId);
            console.log(`[DPD API] Got ${labelResults.length} label(s) for ${order.salesRecordNumber}`);
            labelPdfs = labelResults.filter((l): l is Extract<DPDLabelResult, {type:'pdf'}> => l.type === 'pdf').map(l => l.base64);
            labelHtmls = labelResults.filter((l): l is Extract<DPDLabelResult, {type:'html'}> => l.type === 'html').map(l => l.data);
          } catch (labelErr) {
            console.error(`[DPD API] Label fetch failed for ${order.salesRecordNumber}:`, labelErr);
          }
        }
        
        return { ok: true, orderId: order.id, salesRecordNumber: order.salesRecordNumber, consignmentNumber: consignment?.consignmentNumber, parcelNumber: consignment?.parcelNumber?.[0], labelPdfs, labelHtmls };
      } catch (e) {
        let errorMsg = e instanceof Error ? e.message : String(e);
        if (errorMsg.includes('"code":101') || errorMsg.includes('Failed to query network')) {
          errorMsg = 'DPD reached network lookup but failed (code 101). Check: (1) API key/account profile is enabled for networkCode ' + (process.env.DPD_NETWORK_CODE || '?') + ', (2) collection address depot mapping for postcode ' + (process.env.DPD_COLLECTION_POSTCODE || '?') + ', (3) shipmentDate is valid, (4) account ' + (process.env.DPD_ACCOUNT_NUMBER?.slice(-3) ? '...' + process.env.DPD_ACCOUNT_NUMBER.slice(-3) : '?') + ' is active. Try setting DPD_USE_DOCS_TEST_ADDRESS=true to test with DPD example collection address.';
        }
        console.error(`[DPD API] Error for ${order.salesRecordNumber}:`, errorMsg);
        return { ok: false, orderId: order.id, salesRecordNumber: order.salesRecordNumber, error: errorMsg };
      }
    })
  );

  const succeeded = results.filter((r): r is Extract<ShipResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ShipResult, { ok: false }> => !r.ok).map((r) => ({ orderId: r.orderId, error: r.error }));

  const hasFailures = failed.length > 0;
  const hasSuccesses = succeeded.length > 0;
  const status = hasFailures && hasSuccesses ? 207 : hasFailures ? 502 : 200;

  return NextResponse.json({ succeeded, failed }, { status });
}
