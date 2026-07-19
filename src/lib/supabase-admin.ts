import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// SERVER-ONLY SUPABASE CLIENT
// ----------------------------------------------------------------------------
// Uses the service-role key, which bypasses RLS and must NEVER reach the
// browser (no NEXT_PUBLIC_ prefix — Next.js only inlines NEXT_PUBLIC_* vars).
//
// Why this exists: the app's marketplace credentials live in `app_settings`
// (eBay refresh token, signing key, access tokens). Those rows are currently
// readable with the anon key, which ships inside the client bundle. Moving
// server routes onto this client is the prerequisite for restricting
// `app_settings` so the anon key can no longer read secrets — see
// supabase/migrations/restrict_app_settings_rls.sql.
//
// Until SUPABASE_SERVICE_ROLE_KEY is configured this falls back to the anon
// key, so nothing breaks mid-migration; the fallback is logged once.
// ============================================================================

let warned = false;

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!serviceKey && !warned) {
    warned = true;
    console.warn(
      '[supabase-admin] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon key. ' +
      'Secrets in app_settings stay readable by any browser until this is configured and ' +
      'restrict_app_settings_rls.sql is applied.',
    );
  }

  return createClient(url, serviceKey ?? anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** True once the service-role key is configured — useful for a settings health check. */
export function hasServiceRole(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}
