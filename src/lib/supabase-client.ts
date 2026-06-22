import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    db: {
      schema: 'public',
    },
  });
}

let client: SupabaseClient | null = null;

// Lazy proxy so the build doesn't fail during module import when env vars are missing.
// The client is only created on first use, and will throw then if env vars are absent.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!client) {
      client = createSupabaseClient();
    }
    return (client as any)[prop];
  },
});

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!supabaseUrl && !!supabaseAnonKey;
}
