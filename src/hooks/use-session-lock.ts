'use client';

import { useEffect, useRef } from 'react';
import { useOrderStore } from '@/lib/store';
import { toast } from 'sonner';

// Client half of the single-session lock. Heartbeats the current user's session
// and signs this device out if someone else has claimed the same profile.
//
// Fails open by design: if the endpoint or table is unavailable the user keeps
// working. Losing your session because of a network blip would be far worse
// than briefly allowing two logins.

const HEARTBEAT_MS = 30_000;
const SESSION_KEY = 'app_session_id';

/** Stable per-BROWSER session id, kept in localStorage.
 *
 *  This must NOT be sessionStorage: that is scoped per tab, so opening the app in
 *  a second tab would mint a fresh id, claim the row, and kick the first tab out
 *  (and the second tab would itself be signed out on its first heartbeat, forcing
 *  a re-login). localStorage is shared by every tab of the same browser, so tabs
 *  share one claim — while a different device/browser still has its own id, which
 *  is what the "one active login per user" lock is actually there to enforce.
 *
 *  Falls back to an in-memory id if storage is unavailable (private mode, etc.).
 */
let memorySessionId = '';
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      // Adopt an id this tab already had under the old per-tab key so the switch
      // to localStorage doesn't force one extra re-claim on existing sessions.
      id = sessionStorage.getItem(SESSION_KEY)
        ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    if (!memorySessionId) memorySessionId = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return memorySessionId;
  }
}

/** Coarse device hint for the "already signed in on…" message. No fingerprinting. */
export function getDeviceLabel(): string {
  if (typeof window === 'undefined') return 'unknown device';
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  const browser = /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari'
    : /Firefox/.test(ua) ? 'Firefox' : 'browser';
  return `${browser} on ${os}`;
}

/** Claim the session for a user. Returns null on success, or a reason to show. */
export async function claimSession(
  userId: string,
  force = false,
): Promise<{ blocked: true; device: string; since: string } | null> {
  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: getSessionId(), deviceLabel: getDeviceLabel(), force }),
    });
    if (res.status === 409) {
      const d = await res.json() as { device: string; since: string };
      return { blocked: true, device: d.device, since: d.since };
    }
    return null;
  } catch {
    return null; // fail open
  }
}

/** Release the session on sign-out. */
export async function releaseSession(userId: string): Promise<void> {
  try {
    await fetch('/api/session', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: getSessionId() }),
    });
  } catch { /* best effort */ }
}

/** Heartbeat the session; sign out locally if superseded elsewhere. */
export function useSessionLock() {
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const setCurrentUser = useOrderStore((s) => s.setCurrentUser);
  const kicked = useRef(false);

  useEffect(() => {
    if (!currentUserId) { kicked.current = false; return; }
    let cancelled = false;

    const beat = async () => {
      if (cancelled || kicked.current) return;
      try {
        const res = await fetch('/api/session', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: currentUserId, sessionId: getSessionId(), deviceLabel: getDeviceLabel() }),
        });
        if (!res.ok) return;                       // fail open
        const d = await res.json() as { valid: boolean; takenBy?: string };
        if (!d.valid && !cancelled) {
          kicked.current = true;
          toast.error(`Signed out — this profile was signed in on ${d.takenBy ?? 'another device'}.`, { duration: 10000 });
          setCurrentUser(null);
        }
      } catch { /* fail open */ }
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [currentUserId, setCurrentUser]);
}
