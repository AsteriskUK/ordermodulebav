'use client';

import { Batch, Order } from '@/lib/types';
import { Globe } from 'lucide-react';

const SOURCE_LOGOS: Record<string, { src: string; label: string }> = {
  ebay:       { src: '/ebay.png',        label: 'eBay' },
  amazon:     { src: '/amazon.png',      label: 'Amazon' },
  backmarket: { src: '/backmarket.svg',  label: 'BackMarket' },
  onbuy:      { src: '/onbuy.svg',       label: 'OnBuy' },
  temu:       { src: '/Temu.png',        label: 'Temu' },
};

/** Renders the marketplace logo for an order's source. Returns null for manual/unknown. */
export function OrderSourceLogo({
  source,
  className = 'h-4 w-4',
}: {
  source?: Batch['source'] | string;
  className?: string;
}) {
  const cfg = source ? SOURCE_LOGOS[source] : undefined;
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center justify-center overflow-hidden ${className}`} title={cfg.label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={cfg.src} alt={cfg.label} className="h-full w-full object-contain" />
    </span>
  );
}

/**
 * For GSP (Global Shipping Program) orders the parcel ships to a UK hub, so the
 * "Post to" address is UK-based. This surfaces the buyer's real destination
 * country and billing address so the team knows where it actually ends up.
 */
export function GspDestination({ order, compact = false }: { order: Order; compact?: boolean }) {
  if (!order.isGSP) return null;
  // True eBay GSP ships to a UK hub, so postToCountry is UK — never show that as the
  // destination. Use the buyer's real country; for direct-international orders (no
  // separate buyer country) postToCountry is the real destination.
  const shipsToUkHub = order.postToCountry === 'United Kingdom'
    || !!order.postToPostcode?.toUpperCase().startsWith('WS11');
  const country = order.buyerCountry || (shipsToUkHub ? 'Overseas' : order.postToCountry) || 'Overseas';
  const billing = [
    order.buyerAddress1, order.buyerAddress2, order.buyerCity,
    order.buyerCounty, order.buyerPostcode, order.buyerCountry,
  ].filter(Boolean).join(', ');

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700" title={billing || undefined}>
        <Globe className="h-3 w-3" /> GSP → {country}
      </span>
    );
  }

  return (
    <div className="text-xs bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
      <div className="flex items-center gap-1 font-medium text-blue-800">
        <Globe className="h-3 w-3" /> GSP — ships to UK hub · destination {country}
      </div>
      {billing && <p className="text-blue-700 mt-0.5"><span className="font-medium">Billing:</span> {billing}</p>}
    </div>
  );
}
