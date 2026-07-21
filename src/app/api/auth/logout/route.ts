import { NextResponse } from 'next/server';
import { roleCookieAttributes, ROLE_COOKIE } from '@/lib/auth-cookie';

// POST /api/auth/logout — clear the role cookie on sign-out.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', `${ROLE_COOKIE}=; ${roleCookieAttributes(0)}`);
  return res;
}
