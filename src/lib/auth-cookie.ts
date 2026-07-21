import { UserRole } from './types';

// ============================================================================
// SIGNED ROLE COOKIE (Edge-safe)
// ----------------------------------------------------------------------------
// A tamper-evident, HttpOnly cookie carrying the signed-in user's id + role.
// The middleware reads it to block writes for the read-only 'viewer' role.
//
// Signed with AUTH_SECRET via HMAC-SHA256 using the Web Crypto API, so the same
// code runs in both the Edge middleware and Node API routes. The browser can
// read neither the value (HttpOnly) nor forge a different role without the
// server secret — this is what makes the viewer boundary server-enforced.
// ============================================================================

export const ROLE_COOKIE = 'bav_role';
const MAX_AGE_SECONDS = 12 * 60 * 60; // a working day

export interface RoleToken {
  userId: string;
  role: UserRole;
  exp: number; // unix seconds
}

/** Bytes → fresh ArrayBuffer (a plain BufferSource the Web Crypto types accept). */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}
function bytesFromUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(s: string): Uint8Array {
  const padded = s.length % 4 === 0 ? s : s + '='.repeat(4 - (s.length % 4));
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set — the role cookie cannot be signed.');
  return crypto.subtle.importKey('raw', buf(bytesFromUtf8(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Build a signed cookie value for a user. */
export async function makeRoleToken(userId: string, role: UserRole): Promise<string> {
  const body: RoleToken = { userId, role, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const payload = b64urlEncode(bytesFromUtf8(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), buf(bytesFromUtf8(payload)));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify a cookie value and return its claims, or null if invalid/expired/forged. */
export async function verifyRoleToken(value: string | undefined | null): Promise<RoleToken | null> {
  if (!value || !value.includes('.')) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;

  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), buf(b64urlBytes(sig)), buf(bytesFromUtf8(payload)));
    if (!ok) return null;
    const body = JSON.parse(new TextDecoder().decode(b64urlBytes(payload))) as RoleToken;
    if (!body.role || !body.userId || typeof body.exp !== 'number') return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return body;
  } catch {
    return null;
  }
}

/** Attributes for the Set-Cookie header. HttpOnly so client JS can't touch it. */
export function roleCookieAttributes(maxAge = MAX_AGE_SECONDS): string {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}
