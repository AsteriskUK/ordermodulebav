import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { SETTINGS_STORAGE_KEY, sanitiseSettings, invalidateServerSettingsCache, SettingsValues } from '@/lib/settings';
import { AccessConfig } from '@/lib/types';

// ============================================================================
// NON-SECRET APP CONFIG
// ----------------------------------------------------------------------------
// app_settings holds marketplace credentials alongside configuration, and the
// anon key can no longer read that table once restrict_app_settings_rls.sql is
// applied. This route is the browser's way in: it reads/writes ONLY the
// non-secret config documents and never exposes any other key.
// ============================================================================

// Only these keys may ever be served to a browser through this route.
const PUBLIC_KEYS = [SETTINGS_STORAGE_KEY, 'access_control', 'printer_config'] as const;
type PublicKey = typeof PUBLIC_KEYS[number];

function parse<T>(raw: unknown): T | null {
  if (raw == null) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return null;
  }
}

// GET /api/config → { settings, accessControl, printerConfig }
export async function GET() {
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', PUBLIC_KEYS as unknown as string[]);
    if (error) {
      console.error('[config] read failed:', error.message);
      // Defaults-only is a working state — never block the app on this.
      return NextResponse.json({ settings: null, accessControl: null, printerConfig: null });
    }
    const byKey = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    return NextResponse.json({
      settings: parse<SettingsValues>(byKey[SETTINGS_STORAGE_KEY]),
      accessControl: parse<AccessConfig>(byKey['access_control']),
      printerConfig: parse<Record<string, unknown>>(byKey['printer_config']),
    });
  } catch (e) {
    console.error('[config] unexpected error:', e);
    return NextResponse.json({ settings: null, accessControl: null, printerConfig: null });
  }
}

// PUT /api/config  { key, value }  → save one non-secret config document
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null) as { key?: string; value?: unknown } | null;
  if (!body?.key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  // Hard allow-list: this route must never become a way to write credentials.
  if (!(PUBLIC_KEYS as readonly string[]).includes(body.key)) {
    return NextResponse.json({ error: 'forbidden_key' }, { status: 403 });
  }
  const key = body.key as PublicKey;

  // Settings are validated and stripped to genuine overrides before storage.
  const value = key === SETTINGS_STORAGE_KEY
    ? sanitiseSettings((body.value ?? {}) as SettingsValues).values
    : body.value;

  const supabase = getServiceClient();
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() });
  if (error) {
    console.error('[config] write failed:', error.message);
    return NextResponse.json({ error: 'write_failed', message: error.message }, { status: 500 });
  }
  if (key === SETTINGS_STORAGE_KEY) invalidateServerSettingsCache();
  return NextResponse.json({ success: true, value });
}
