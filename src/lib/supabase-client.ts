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

// ---------------------------------------------------------------------------
// Read-only guard
// ---------------------------------------------------------------------------
// The app writes core data (orders, returns, tickets, users, inventory) DIRECTLY
// to Supabase from the browser with the anon key — those calls do not go through
// /api, so the server proxy never sees them. This guard is the client-side choke
// that makes a read-only 'viewer' genuinely read-only: while active, every write
// through the shared client (insert/update/upsert/delete, rpc, storage upload/
// remove) is refused without hitting the network.
//
// (A determined user with the anon key could still craft raw REST calls in
// devtools — that residual is only closed by locking down table RLS.)

let readOnly = false;
export function setSupabaseReadOnly(value: boolean): void { readOnly = value; }
export function isSupabaseReadOnly(): boolean { return readOnly; }

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);
const STORAGE_WRITE_OPS = new Set(['upload', 'update', 'remove', 'move', 'copy', 'createSignedUploadUrl', 'uploadToSignedUrl']);

const READ_ONLY_ERROR = { message: 'This is a read-only account. Changes are not permitted.', code: 'READ_ONLY', details: '', hint: '' };

/** A chainable, awaitable stand-in that resolves to a read-only error without a network call. */
function blockedBuilder(): unknown {
  const result = { data: null, error: READ_ONLY_ERROR, count: null, status: 403, statusText: 'READ_ONLY' };
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: typeof result) => unknown) => resolve(result);
      if (prop === 'catch') return () => proxy;
      if (prop === 'finally') return (cb?: () => void) => { try { cb?.(); } catch { /* ignore */ } return proxy; };
      // Any chained query method (eq, select, single, order, …) returns the same stand-in.
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}

function guardedQuery(builder: unknown): unknown {
  return new Proxy(builder as object, {
    get(target, prop) {
      if (typeof prop === 'string' && WRITE_OPS.has(prop)) {
        return () => blockedBuilder();
      }
      const value = (target as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function guardedStorage(storage: unknown): unknown {
  return new Proxy(storage as object, {
    get(target, prop) {
      if (prop === 'from') {
        return (bucket: string) => {
          const bucketApi = (target as { from: (b: string) => unknown }).from(bucket);
          return new Proxy(bucketApi as object, {
            get(b, p) {
              if (typeof p === 'string' && STORAGE_WRITE_OPS.has(p)) {
                return () => Promise.resolve({ data: null, error: READ_ONLY_ERROR });
              }
              const v = (b as Record<string | symbol, unknown>)[p];
              return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(b) : v;
            },
          });
        };
      }
      const value = (target as Record<string | symbol, unknown>)[prop];
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// Lazy proxy so the build doesn't fail during module import when env vars are
// missing. Also applies the read-only guard when a viewer is signed in.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!client) client = createSupabaseClient();
    const c = client as unknown as Record<string | symbol, unknown>;
    const bound = (v: unknown) => (typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client) : v);

    if (readOnly) {
      if (prop === 'from') return (table: string) => guardedQuery((client as SupabaseClient).from(table));
      if (prop === 'rpc') return () => blockedBuilder();
      if (prop === 'storage') return guardedStorage((client as SupabaseClient).storage);
    }
    return bound(c[prop]);
  },
});

// Helper to check if Supabase is configured
export function isSupabaseConfigured(): boolean {
  return !!supabaseUrl && !!supabaseAnonKey;
}
