'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase-client';
import { useOrderStore } from '@/lib/store';

// ============================================================================
// SUPABASE SESSION GATE
// ----------------------------------------------------------------------------
// A live, Supabase-verified session — not a value lingering in the browser
// store — is what grants access to the app. This hook surfaces that session and
// keeps the app identity in step with it: when Supabase reports the session is
// gone (sign-out, expiry, refresh failure) the app user is cleared so a stale
// `currentUserId` in localStorage can never keep someone in.
// ============================================================================

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  // When Supabase isn't configured (local dev without env) there's nothing to
  // gate on — report "not loading, no session" and let callers fall back.
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      if (event === 'SIGNED_OUT' || !s) {
        // Drop the in-app identity too; the role cookie is cleared on sign-out.
        useOrderStore.getState().setCurrentUser(null);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    loading,
    // True only when we can actually enforce a session (env present).
    authRequired: isSupabaseConfigured(),
  };
}

/** Resolve the app user for an existing session (used after a reload, when the
 *  Supabase session persists but the in-app identity was lost). Mints a fresh
 *  role cookie server-side and returns whether an identity was established. */
export async function resolveAppUserFromSession(session: Session): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token }),
    });
    if (!res.ok) return false;
    const { user } = await res.json() as { user: import('@/lib/types').AppUser };
    const store = useOrderStore.getState();
    useOrderStore.setState((s) => (
      s.users.some((u) => u.id === user.id) ? {} : { users: [...s.users, user] }
    ));
    store.setCurrentUser(user.id);
    return true;
  } catch {
    return false;
  }
}
