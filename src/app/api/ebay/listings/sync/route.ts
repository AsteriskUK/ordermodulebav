import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEbayAccessToken } from '@/lib/ebay-client';

const TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

function getXmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function getXmlValueNested(xml: string, path: string): string | null {
  const tags = path.split('.');
  let current = xml;
  for (const tag of tags) {
    const match = current.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!match) return null;
    current = match[1];
  }
  return current.trim();
}

function parseListingItems(xml: string) {
  const itemRegex = /<Item>([\s\S]*?)<\/Item>/gi;
  const items: {
    itemId: string;
    sku: string | null;
    title: string | null;
    description: string | null;
    price: number | null;
    currency: string;
    quantity: number;
    condition: string | null;
    status: string | null;
    listingType: string | null;
    categoryId: string | null;
    categoryName: string | null;
    imageUrl: string | null;
    listingUrl: string | null;
  }[] = [];
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const itemId = getXmlValue(itemXml, 'ItemID');
    if (!itemId) continue;

    const priceXml = getXmlValueNested(itemXml, 'StartPrice') || getXmlValueNested(itemXml, 'SellingStatus.CurrentPrice');
    const price = priceXml ? Number(priceXml) : null;
    const priceTag = itemXml.match(/<(StartPrice|CurrentPrice)[^>]*currencyID="([^"]+)"/i);
    const currency = priceTag ? priceTag[2] : 'GBP';

    const pictureDetails = getXmlValueNested(itemXml, 'PictureDetails') || '';
    const pictureUrl = getXmlValue(pictureDetails, 'PictureURL') || getXmlValue(pictureDetails, 'GalleryURL') || getXmlValue(itemXml, 'GalleryURL');
    const title = getXmlValue(itemXml, 'Title');
    const description = getXmlValue(itemXml, 'Description');
    const sku = getXmlValue(itemXml, 'SKU');
    const qty = getXmlValue(itemXml, 'QuantityAvailable') || getXmlValue(itemXml, 'Quantity');
    const status = getXmlValueNested(itemXml, 'SellingStatus.ListingStatus');
    const condition = getXmlValueNested(itemXml, 'ConditionDisplayName') || getXmlValue(itemXml, 'ConditionDescription');
    const listingType = getXmlValue(itemXml, 'ListingType');
    const categoryId = getXmlValueNested(itemXml, 'PrimaryCategory.CategoryID');
    const categoryName = getXmlValueNested(itemXml, 'PrimaryCategory.CategoryName');
    const listingUrl = getXmlValue(itemXml, 'ViewItemURL');

    items.push({
      itemId,
      sku,
      title,
      description,
      price,
      currency,
      quantity: qty ? Number(qty) : 0,
      condition,
      status,
      listingType,
      categoryId,
      categoryName,
      imageUrl: pictureUrl,
      listingUrl,
    });
  }
  return items;
}

export async function POST() {
  const token = await getEbayAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected', message: 'eBay account not connected' }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date();
  const nowIso = now.toISOString();

  const allItems = [] as ReturnType<typeof parseListingItems>;
  const pageSize = 200;
  let totalItems = 0;

  // Fetch active listings: EndTime range walks from now into the future.
  // eBay limits GetSellerList date range to 121 days, so use 120-day windows.
  const futureLimit = new Date(now);
  futureLimit.setMonth(futureLimit.getMonth() + 24); // listings can renew up to 2 years out
  const windowMs = 120 * 24 * 60 * 60 * 1000;

  let windowStart = new Date(now);
  while (windowStart < futureLimit) {
    const windowEnd = new Date(Math.min(windowStart.getTime() + windowMs, futureLimit.getTime()));
    let pageNumber = 1;
    let totalPages = 1;

    while (pageNumber <= totalPages) {
      const body = `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <EndTimeFrom>${windowStart.toISOString()}</EndTimeFrom>
  <EndTimeTo>${windowEnd.toISOString()}</EndTimeTo>
  <Pagination>
    <EntriesPerPage>${pageSize}</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
</GetSellerListRequest>`;

      const res = await fetch(TRADING_API_URL, {
        method: 'POST',
        headers: {
          'X-EBAY-API-CALL-NAME': 'GetSellerList',
          'X-EBAY-API-SITEID': '3',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '1207',
          'X-EBAY-API-IAF-TOKEN': token,
          'Content-Type': 'text/xml',
        },
        body,
      });

      const xml = await res.text();
      if (!res.ok) {
        console.error('[eBay listings sync] GetSellerList error', res.status, xml.slice(0, 400));
        return NextResponse.json({ error: 'ebay_api_error', message: xml.slice(0, 400) }, { status: 502 });
      }

      const ack = getXmlValue(xml, 'Ack');
      if (ack === 'Failure') {
        const err = getXmlValueNested(xml, 'Errors.LongMessage') || xml.slice(0, 400);
        console.error('[eBay listings sync] GetSellerList failure', err);
        return NextResponse.json({ error: 'ebay_api_error', message: err }, { status: 502 });
      }

      const items = parseListingItems(xml);
      allItems.push(...items);

      if (pageNumber === 1) {
        const total = getXmlValueNested(xml, 'PaginationResult.TotalNumberOfEntries');
        totalItems += total ? Number(total) : 0;
        const pages = getXmlValueNested(xml, 'PaginationResult.TotalNumberOfPages');
        totalPages = pages ? Number(pages) : 1;
      }

      if (items.length < pageSize) break;
      pageNumber += 1;
    }

    windowStart = new Date(windowEnd.getTime());
  }

  // Build rows keyed by SKU; if no SKU, use itemId as the SKU column.
  // Deduplicate by SKU so Postgres upsert doesn't hit the same row twice.
  type DbRow = {
    sku: string;
    item_id: string;
    title: string | null;
    description: string | null;
    image_url: string | null;
    additional_images: string[];
    price: number | null;
    currency: string;
    quantity: number;
    condition: string | null;
    listing_status: string;
    listing_type: string | null;
    category_id: string | null;
    category_name: string | null;
    listing_url: string;
    last_synced_at: string;
  };
  const rowMap = new Map<string, DbRow>();
  for (const item of allItems) {
    const sku = item.sku?.trim() || item.itemId;
    rowMap.set(sku, {
      sku,
      item_id: item.itemId,
      title: item.title,
      description: item.description,
      image_url: item.imageUrl,
      additional_images: [],
      price: item.price,
      currency: item.currency,
      quantity: item.quantity,
      condition: item.condition,
      listing_status: (item.status || 'Active').toLowerCase(),
      listing_type: item.listingType,
      category_id: item.categoryId,
      category_name: item.categoryName,
      listing_url: item.listingUrl || `https://www.ebay.co.uk/itm/${item.itemId}`,
      last_synced_at: nowIso,
    });
  }
  const rows = Array.from(rowMap.values());

  // Mark listings not returned by eBay as inactive
  const syncedSkus = new Set(rows.map((r) => r.sku));
  const { data: existing } = await supabase.from('ebay_live_listings').select('sku');
  const missingSkus = (existing ?? []).map((e) => e.sku).filter((s) => !syncedSkus.has(s));
  if (missingSkus.length > 0) {
    await supabase.from('ebay_live_listings').update({ listing_status: 'inactive', last_synced_at: nowIso }).in('sku', missingSkus);
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('ebay_live_listings').upsert(rows, { onConflict: 'sku' });
    if (error) {
      console.error('[eBay listings sync] upsert error', error.message);
      return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    synced: rows.length,
    inactive: missingSkus.length,
    totalItems,
  });
}

// GET returns current sync summary from DB
export async function GET() {
  const supabase = getSupabase();
  const { count: active, error: activeError } = await supabase
    .from('ebay_live_listings')
    .select('*', { count: 'exact', head: true })
    .eq('listing_status', 'active');
  const { count: total, error: totalError } = await supabase
    .from('ebay_live_listings')
    .select('*', { count: 'exact', head: true });
  const { data: latest } = await supabase
    .from('ebay_live_listings')
    .select('last_synced_at')
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .single();

  if (activeError || totalError) {
    return NextResponse.json({ error: 'db_error', message: activeError?.message || totalError?.message }, { status: 500 });
  }

  return NextResponse.json({
    active: active ?? 0,
    total: total ?? 0,
    lastSyncedAt: latest?.last_synced_at ?? null,
  });
}
