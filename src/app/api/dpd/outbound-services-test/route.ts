import { NextRequest, NextResponse } from 'next/server';
import { validateDpdOutboundServices } from '@/lib/dpd-client';

export async function GET(req: NextRequest) {
  const useDocsAddresses = process.env.DPD_USE_DOCS_TEST_ADDRESS === 'true' || process.env.DPD_USE_FULL_DOCS_TEST_ADDRESSES === 'true';

  const collectionPostcode = useDocsAddresses ? 'B66 1BY' : (process.env.DPD_COLLECTION_POSTCODE ?? '');
  const collectionTown = useDocsAddresses ? 'Birmingham' : (process.env.DPD_COLLECTION_CITY ?? '');
  const deliveryPostcode = useDocsAddresses ? 'EC1A 1BB' : (req.nextUrl.searchParams.get('deliveryPostcode') ?? 'EC1A 1BB');
  const deliveryTown = useDocsAddresses ? 'London' : (req.nextUrl.searchParams.get('deliveryTown') ?? 'London');

  const requestPayload = {
    collectionPostcode,
    collectionTown,
    collectionCountryCode: 'GB',
    deliveryPostcode,
    deliveryTown,
    deliveryCountryCode: 'GB',
    totalWeight: 1,
    numberOfParcels: 1,
  };

  let services: unknown = null;
  let selectedNetworkKey: string | null = null;
  let error: string | null = null;

  try {
    const result = await validateDpdOutboundServices(requestPayload);
    services = result;

    if (result.length > 0) {
      const preferred = process.env.DPD_PREFERRED_NETWORK_CODE;
      if (preferred) {
        const match = result.find((s) => s.networkKey === preferred || s.networkCode === preferred);
        selectedNetworkKey = match ? match.networkKey : result[0].networkKey;
      } else {
        selectedNetworkKey = result[0].networkKey;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    usingDocsAddresses: useDocsAddresses,
    requestPayload,
    availableServices: services,
    selectedNetworkKey,
    preferredNetworkCode: process.env.DPD_PREFERRED_NETWORK_CODE ?? null,
    error,
  });
}
