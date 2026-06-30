import { Build, InventoryPart, StockLevel, StockUnit } from './types';

export interface PartAvailability {
  onHand: number;     // physical stock (bulk = sum of levels; serialized = in_stock + in_build units)
  reserved: number;   // held by active (reserved) builds
  available: number;  // onHand − reserved; CAN be negative (negative inventory is allowed)
}

/**
 * Stock position for a part. Reserved is computed from builds currently on hold,
 * so there's a single source of truth and no double-bookkeeping. Available is
 * allowed to go negative — the warehouse is never blocked from building.
 */
export function computeAvailability(
  partId: string,
  part: InventoryPart | undefined,
  stockLevels: StockLevel[],
  stockUnits: StockUnit[],
  builds: Build[],
): PartAvailability {
  const tracking = part?.tracking ?? 'bulk';

  const onHand = tracking === 'bulk'
    ? stockLevels.filter((l) => l.partId === partId).reduce((s, l) => s + (l.quantity ?? 0), 0)
    : stockUnits.filter((u) => u.partId === partId && (u.status === 'in_stock' || u.status === 'in_build')).length;

  const reserved = builds
    .filter((b) => b.status === 'reserved')
    .flatMap((b) => b.lines)
    .filter((l) => l.partId === partId)
    .reduce((s, l) => s + (l.quantity || 1), 0);

  return { onHand, reserved, available: onHand - reserved };
}
