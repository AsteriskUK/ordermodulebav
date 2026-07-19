// ============================================================================
// SETTINGS ACCESS
// ----------------------------------------------------------------------------
// One way in and one way out for configuration:
//   • Client:  useSetting('queue.maxVisiblePerStage')   — reactive
//   • Server:  await getSetting('queue.maxVisiblePerStage')
//
// A stored value always overrides its registry default; a missing, invalid or
// unreachable value falls back to the default, so the app keeps working even
// with no settings row at all (or with Supabase down).
// ============================================================================

import { SettingValue, SETTING_DEFAULTS, SETTING_FIELD_BY_KEY, validateSetting } from './settings-schema';

export type SettingsValues = Record<string, SettingValue>;

/** app_settings key holding the whole config document (mirrors `access_control`). */
export const SETTINGS_STORAGE_KEY = 'app_config';

// ---------------------------------------------------------------------------
// Typed resolution
// ---------------------------------------------------------------------------

/**
 * Resolve one setting from a values map, falling back to the registry default.
 * Invalid stored values are ignored rather than trusted — a bad row must never
 * take the app down.
 */
export function resolveSetting<T extends SettingValue = SettingValue>(
  values: SettingsValues | null | undefined,
  key: string,
): T {
  const fallback = SETTING_DEFAULTS[key] as T;
  const stored = values?.[key];
  if (stored === undefined || stored === null) return fallback;
  if (validateSetting(key, stored) !== null) {
    console.warn(`[settings] ignoring invalid value for "${key}"`);
    return fallback;
  }
  return stored as T;
}

/** Convenience typed readers — they coerce, so callers get what they expect. */
export const asNumber = (v: SettingValue): number => Number(v);
export const asBool = (v: SettingValue): boolean => v === true || v === 'true';
export const asString = (v: SettingValue): string => (v == null ? '' : String(v));
export const asList = (v: SettingValue): string[] => (Array.isArray(v) ? v : []);

/** Milliseconds from a setting stored in minutes. */
export const minutesToMs = (v: SettingValue): number => Math.max(0, Number(v)) * 60_000;

// ---------------------------------------------------------------------------
// Sanitising writes
// ---------------------------------------------------------------------------

/**
 * Drop unknown keys and invalid values, and omit anything equal to its default
 * so the stored document only ever contains genuine overrides (keeps exports
 * readable and lets changed defaults reach existing installs).
 */
export function sanitiseSettings(input: SettingsValues): { values: SettingsValues; errors: Record<string, string> } {
  const values: SettingsValues = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SETTING_FIELD_BY_KEY[key]) continue;              // unknown key — ignore
    const error = validateSetting(key, value);
    if (error) { errors[key] = error; continue; }
    if (JSON.stringify(value) === JSON.stringify(SETTING_DEFAULTS[key])) continue; // same as default
    values[key] = value;
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Server-side access (API routes) — cached, never throws
// ---------------------------------------------------------------------------

let serverCache: { values: SettingsValues; at: number } | null = null;
const SERVER_CACHE_MS = 30_000;

/** Force the next server read to hit the database (called after a save). */
export function invalidateServerSettingsCache(): void {
  serverCache = null;
}

async function fetchSettingsFromDb(): Promise<SettingsValues> {
  // Imported lazily so this module stays usable in contexts without Supabase.
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return {};
  const supabase = createClient(url, key);
  const { data } = await supabase.from('app_settings').select('value').eq('key', SETTINGS_STORAGE_KEY).maybeSingle();
  if (!data?.value) return {};
  try {
    return typeof data.value === 'string' ? JSON.parse(data.value) : (data.value as SettingsValues);
  } catch {
    return {};
  }
}

/** All settings, server-side. Falls back to defaults-only on any failure. */
export async function getSettings(): Promise<SettingsValues> {
  if (serverCache && Date.now() - serverCache.at < SERVER_CACHE_MS) return serverCache.values;
  try {
    const values = await fetchSettingsFromDb();
    serverCache = { values, at: Date.now() };
    return values;
  } catch (e) {
    console.warn('[settings] server read failed, using defaults', e);
    return serverCache?.values ?? {};
  }
}

/** One setting, server-side. */
export async function getSetting<T extends SettingValue = SettingValue>(key: string): Promise<T> {
  return resolveSetting<T>(await getSettings(), key);
}
