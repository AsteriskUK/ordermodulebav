'use client';

import { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';

interface Listing {
  image_url: string | null;
  web_url: string | null;
  title: string | null;
}

// Module-level cache so a table of 25 rows doesn't refire the same listing
// lookups on every render/page change (the API also caches in Supabase).
const listingCache = new Map<string, Promise<Listing | null>>();

function fetchListing(itemId: string): Promise<Listing | null> {
  let p = listingCache.get(itemId);
  if (!p) {
    p = fetch(`/api/ebay/listing?itemId=${itemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.listing?.image_url ? d.listing as Listing : null))
      .catch(() => null);
    listingCache.set(itemId, p);
  }
  return p;
}

/**
 * Product photo for an order row — resolves the eBay listing image from the
 * order's item number. Non-eBay / unknown items show a neutral placeholder.
 */
export function ItemThumb({ itemNumber, className = 'h-9 w-9' }: { itemNumber?: string; className?: string }) {
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListing(null);
    if (!itemNumber || !/^\d+$/.test(itemNumber)) return;
    let alive = true;
    fetchListing(itemNumber).then((l) => { if (alive) setListing(l); });
    return () => { alive = false; };
  }, [itemNumber]);

  if (!listing?.image_url) {
    return (
      <div className={`${className} rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0`}>
        <ShoppingBag className="h-4 w-4 text-slate-300" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={listing.image_url}
      alt={listing.title ?? 'listing'}
      className={`${className} rounded-md object-cover border border-slate-200 shrink-0`}
      loading="lazy"
    />
  );
}
