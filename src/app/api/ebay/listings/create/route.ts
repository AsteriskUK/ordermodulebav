import { NextRequest, NextResponse } from 'next/server';
import { getEbayAccessToken, EBAY_BASE_URL, EBAY_MARKETPLACE_ID } from '@/lib/ebay-client';
import { CreateListingPayload, VariationPayload } from '@/lib/types';

const INVENTORY_BASE = `${EBAY_BASE_URL}/sell/inventory/v1`;

type AuthHeaders = { Authorization: string; 'Content-Type': string; 'X-EBAY-C-MARKETPLACE-ID': string };

function makeHeaders(token: string): AuthHeaders {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
  };
}

async function createInventoryItem(
  token: string,
  sku: string,
  payload: CreateListingPayload,
  overrideAspects?: Record<string, string[]>,
  overrideImageUrls?: string[]
) {
  const res = await fetch(`${INVENTORY_BASE}/inventory_item/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    headers: makeHeaders(token),
    body: JSON.stringify({
      availability: {
        shipToLocationAvailability: { quantity: payload.quantity },
      },
      condition: payload.condition,
      product: {
        title: payload.title,
        description: payload.description,
        imageUrls: overrideImageUrls ?? payload.imageUrls,
        aspects: overrideAspects ?? payload.aspects,
      },
    }),
  });
  return res;
}

async function createOffer(
  token: string,
  sku: string,
  payload: CreateListingPayload,
  overridePrice?: number,
  overrideQuantity?: number
) {
  const res = await fetch(`${INVENTORY_BASE}/offer`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      sku,
      marketplaceId: EBAY_MARKETPLACE_ID,
      format: 'FIXED_PRICE',
      listingDuration: 'GTC',
      availableQuantity: overrideQuantity ?? payload.quantity,
      categoryId: payload.categoryId,
      merchantLocationKey: payload.merchantLocationKey,
      pricingSummary: {
        price: { value: String(overridePrice ?? payload.price), currency: 'GBP' },
      },
      listingPolicies: {
        paymentPolicyId: payload.paymentPolicyId,
        returnPolicyId: payload.returnPolicyId,
        fulfillmentPolicyId: payload.fulfillmentPolicyId,
      },
    }),
  });
  return res;
}

// --- Single-SKU flow ---
async function createSingleListing(token: string, payload: CreateListingPayload) {
  const itemRes = await fetch(
    `${INVENTORY_BASE}/inventory_item/${encodeURIComponent(payload.sku)}`,
    {
      method: 'PUT',
      headers: makeHeaders(token),
      body: JSON.stringify({
        availability: {
          shipToLocationAvailability: { quantity: payload.quantity },
        },
        condition: payload.condition,
        product: {
          title: payload.title,
          description: payload.description,
          imageUrls: payload.imageUrls,
          aspects: payload.aspects,
        },
      }),
    }
  );

  if (!itemRes.ok && itemRes.status !== 204) {
    return { error: 'inventory_item_failed', message: await itemRes.text(), step: 'inventory_item', status: itemRes.status };
  }

  const offerRes = await fetch(`${INVENTORY_BASE}/offer`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      sku: payload.sku,
      marketplaceId: EBAY_MARKETPLACE_ID,
      format: payload.format,
      listingDuration: payload.format === 'AUCTION' ? 'DAYS_7' : 'GTC',
      availableQuantity: payload.quantity,
      categoryId: payload.categoryId,
      merchantLocationKey: payload.merchantLocationKey,
      pricingSummary: {
        price: { value: String(payload.price), currency: 'GBP' },
      },
      listingPolicies: {
        paymentPolicyId: payload.paymentPolicyId,
        returnPolicyId: payload.returnPolicyId,
        fulfillmentPolicyId: payload.fulfillmentPolicyId,
      },
    }),
  });

  if (!offerRes.ok) {
    return { error: 'offer_create_failed', message: await offerRes.text(), step: 'create_offer', status: offerRes.status };
  }

  const { offerId } = (await offerRes.json()) as { offerId: string };

  const publishRes = await fetch(
    `${INVENTORY_BASE}/offer/${encodeURIComponent(offerId)}/publish`,
    { method: 'POST', headers: makeHeaders(token) }
  );

  if (!publishRes.ok) {
    return { error: 'publish_failed', message: await publishRes.text(), offerId, step: 'publish_offer', status: publishRes.status };
  }

  const { listingId } = (await publishRes.json()) as { listingId: string };
  return { success: true, listingId, offerId };
}

// --- Multiple-variation flow ---
async function createVariationListing(
  token: string,
  payload: CreateListingPayload,
  variations: VariationPayload[],
  varyingAspects: string[]
) {
  // Step 1: Create one inventory item per variation (only the pivoting aspects on each item)
  for (const variation of variations) {
    const uniqueAspects: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(variation.aspectValues)) {
      uniqueAspects[k] = [v];
    }
    const imageUrls = variation.imageUrl ? [variation.imageUrl] : payload.imageUrls;

    const itemRes = await createInventoryItem(token, variation.sku, payload, uniqueAspects, imageUrls);
    // 204 = success (updated), 201 = created
    if (!itemRes.ok && itemRes.status !== 204) {
      return {
        error: 'inventory_item_failed',
        message: await itemRes.text(),
        step: `inventory_item:${variation.sku}`,
        status: itemRes.status,
      };
    }
  }

  // Step 2: Create one offer per variation (all FIXED_PRICE, GTC)
  for (const variation of variations) {
    const offerRes = await createOffer(token, variation.sku, payload, variation.price, variation.quantity);
    if (!offerRes.ok) {
      return {
        error: 'offer_create_failed',
        message: await offerRes.text(),
        step: `create_offer:${variation.sku}`,
        status: offerRes.status,
      };
    }
  }

  // Step 3: Create inventory item group
  // Build variesBy.specifications: for each varying aspect, collect all values across variations
  const specifications = varyingAspects.map((aspectName) => ({
    name: aspectName,
    values: [...new Set(variations.map((v) => v.aspectValues[aspectName]).filter(Boolean))],
  }));

  const groupRes = await fetch(
    `${INVENTORY_BASE}/inventory_item_group/${encodeURIComponent(payload.sku)}`,
    {
      method: 'PUT',
      headers: makeHeaders(token),
      body: JSON.stringify({
        inventoryItemGroupKey: payload.sku,
        variantSKUs: variations.map((v) => v.sku),
        title: payload.title,
        description: payload.description,
        imageUrls: payload.imageUrls,
        aspects: payload.aspects,
        variesBy: {
          aspectsImageVariesBy: varyingAspects[0],
          specifications,
        },
      }),
    }
  );

  if (!groupRes.ok) {
    return {
      error: 'group_create_failed',
      message: await groupRes.text(),
      step: 'create_group',
      status: groupRes.status,
    };
  }

  // Step 4: Publish by group
  const publishRes = await fetch(`${INVENTORY_BASE}/offer/publish_by_inventory_item_group`, {
    method: 'POST',
    headers: makeHeaders(token),
    body: JSON.stringify({
      inventoryItemGroupKey: payload.sku,
      marketplaceId: EBAY_MARKETPLACE_ID,
    }),
  });

  if (!publishRes.ok) {
    return {
      error: 'publish_failed',
      message: await publishRes.text(),
      step: 'publish_group',
      status: publishRes.status,
    };
  }

  const { listingId } = (await publishRes.json()) as { listingId: string };
  return { success: true, listingId };
}

export async function POST(req: NextRequest) {
  const token = await getEbayAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const payload: CreateListingPayload = await req.json();

  const result =
    payload.variations && payload.variations.length > 0
      ? await createVariationListing(token, payload, payload.variations, payload.varyingAspects ?? [])
      : await createSingleListing(token, payload);

  if ('error' in result) {
    const { status, ...body } = result;
    return NextResponse.json(body, { status: status ?? 500 });
  }

  return NextResponse.json(result);
}
