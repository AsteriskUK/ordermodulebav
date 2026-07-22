'use client';

import { useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { setSupabaseReadOnly } from '@/lib/supabase-client';

/** True when the signed-in user is a read-only 'viewer'. */
export function useReadOnly(): boolean {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  return users.find((u) => u.id === currentUserId)?.role === 'viewer';
}

// ---------------------------------------------------------------------------
// Client-side write guard
// ---------------------------------------------------------------------------
// Belt-and-braces to the server proxy: while a viewer is signed in, intercept
// mutating fetches to /api/* and short-circuit them with a friendly message,
// so the UI never appears to "work" and there's no needless round-trip. The
// server still enforces the real boundary — this is purely for UX.

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT = ['/api/auth/', '/api/session'];
let readOnlyActive = false;
let installed = false;

function isWriteToApi(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (typeof input !== 'string' && 'method' in input ? input.method : 'GET') ?? 'GET').toUpperCase();
  if (!WRITE_METHODS.has(method)) return false;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  const path = url.startsWith('http') ? new URL(url).pathname : url;
  if (!path.startsWith('/api/')) return false;
  return !EXEMPT.some((p) => path.startsWith(p));
}

/** Installs the fetch guard once and keeps it in sync with read-only state. */
export function useInstallReadOnlyGuard(): void {
  const readOnly = useReadOnly();
  // Set both guards synchronously on every render so even the first action after
  // a viewer signs in is covered — the Supabase client guard blocks the direct
  // DB writes the app makes with the anon key (its main write path).
  readOnlyActive = readOnly;
  setSupabaseReadOnly(readOnly);
  useEffect(() => { readOnlyActive = readOnly; setSupabaseReadOnly(readOnly); }, [readOnly]);

  useEffect(() => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (readOnlyActive && isWriteToApi(input, init)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'read_only', message: 'This is a read-only account.' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return originalFetch(input, init);
    };
  }, []);
}
