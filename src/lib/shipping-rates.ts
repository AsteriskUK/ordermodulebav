import { DPDService } from './types';

/**
 * DPD has no public rating endpoint for account customers — prices are set by
 * your negotiated contract — so DPD label costs come from a configurable rate
 * card rather than a live API. FedEx prices come from its live Rate API.
 *
 * Rates are £ per parcel. Override the defaults with a DPD_RATE_CARD env var
 * holding JSON keyed by DPDService, e.g.
 *   DPD_RATE_CARD={"next_day":6.25,"by_1030":11.5}
 * Anything omitted falls back to the defaults below.
 */

export const DPD_DEFAULT_RATE_CARD: Record<DPDService, number> = {
  next_day: 6.5,
  by_1030: 12.0,
  by_12: 9.0,
  saturday: 12.0,
  saturday_by_1030: 18.0,
  saturday_by_12: 15.0,
  sunday: 15.0,
  sunday_by_12: 18.0,
};

let _cachedCard: Record<DPDService, number> | null = null;

function rateCard(): Record<DPDService, number> {
  if (_cachedCard) return _cachedCard;
  const card = { ...DPD_DEFAULT_RATE_CARD };
  const raw = process.env.DPD_RATE_CARD;
  if (raw) {
    try {
      const overrides = JSON.parse(raw) as Partial<Record<DPDService, number>>;
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === 'number' && k in card) card[k as DPDService] = v;
      }
    } catch {
      console.warn('[shipping-rates] DPD_RATE_CARD is not valid JSON — using defaults');
    }
  }
  _cachedCard = card;
  return card;
}

/** Estimated DPD label cost (£) for a service and box count, from the rate card. */
export function estimateDpdCost(service: string | undefined, boxes: number): number {
  const card = rateCard();
  const perParcel = card[(service as DPDService)] ?? card.next_day;
  return perParcel * Math.max(1, boxes);
}
