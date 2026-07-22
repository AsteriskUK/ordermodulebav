'use client';

import { useEffect } from 'react';
import { useOrderStore, setStoreReadOnly } from '@/lib/store';
import { setSupabaseReadOnly } from '@/lib/supabase-client';

/** True when the signed-in user is a read-only 'viewer'.
 *  Authoritative source is the server-signed cookie (sessionRole); the users-list
 *  check is a fallback so it still works before /api/auth/me resolves. Either
 *  saying 'viewer' locks the session read-only. */
export function useReadOnly(): boolean {
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const sessionRole = useOrderStore((s) => s.sessionRole);
  if (sessionRole === 'viewer') return true;
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
  const currentUserId = useOrderStore((s) => s.currentUserId);

  // Ask the server (signed cookie) what role we actually are, so read-only holds
  // even when the user isn't present in the synced users list (e.g. inactive).
  // setState bypasses the store's read-only guard, so this write always applies.
  useEffect(() => {
    let cancelled = false;
    if (!currentUserId) { useOrderStore.setState({ sessionRole: null }); return; }
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { role: string | null }) => { if (!cancelled) useOrderStore.setState({ sessionRole: d.role ?? null }); })
      .catch(() => { /* keep the users-list fallback */ });
    return () => { cancelled = true; };
  }, [currentUserId]);

  const readOnly = useReadOnly();
  // Set both guards synchronously on every render so even the first action after
  // a viewer signs in is covered — the Supabase client guard blocks the direct
  // DB writes the app makes with the anon key (its main write path).
  readOnlyActive = readOnly;
  setSupabaseReadOnly(readOnly);
  setStoreReadOnly(readOnly);
  useEffect(() => { readOnlyActive = readOnly; setSupabaseReadOnly(readOnly); setStoreReadOnly(readOnly); }, [readOnly]);

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
