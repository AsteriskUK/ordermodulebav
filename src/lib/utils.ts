import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Deterministic UUID (v4-formatted) derived from a seed string. Pure JS (works
 * server + client). Stable across imports, so re-importing the same order upserts
 * the same row. Used to turn marketplace ids like "onbuy-77257996" into valid
 * UUIDs — the DB `id` columns are `uuid`, and syncOrder/syncBatch skip non-UUIDs.
 */
export function stableUuid(seed: string): string {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 4) {
    const r = next();
    bytes[i] = r & 0xff;
    bytes[i + 1] = (r >>> 8) & 0xff;
    bytes[i + 2] = (r >>> 16) & 0xff;
    bytes[i + 3] = (r >>> 24) & 0xff;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
