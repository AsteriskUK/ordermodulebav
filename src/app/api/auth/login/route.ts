import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { makeRoleToken, roleCookieAttributes, ROLE_COOKIE } from '@/lib/auth-cookie';
import { UserRole } from '@/lib/types';

// POST /api/auth/login  { userId, pin }
// Verifies the PIN server-side against the users table and issues a signed,
// HttpOnly role cookie. The cookie is the authoritative source of the caller's
// role for the write-blocking middleware — the client cannot forge it.
//
// This is deliberately additive: existing client-side sign-in still runs. The
// cookie exists so the server can reliably identify a read-only 'viewer'.
export async function POST(req: Request) {
  const { userId, pin } = await req.json().catch(() => ({})) as { userId?: string; pin?: string };
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const supabase = getServiceClient();
  const { data: user, error } = await supabase
    .from('users')
    .select('id, role, pin, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error || !user || user.is_active === false) {
    return NextResponse.json({ error: 'unknown_user' }, { status: 401 });
  }
  // Admins in the seed data may have no PIN; only enforce a PIN when one is set.
  if (user.pin && String(user.pin) !== String(pin ?? '')) {
    return NextResponse.json({ error: 'bad_pin' }, { status: 401 });
  }

  const role = (user.role ?? 'staff') as UserRole;
  const token = await makeRoleToken(user.id, role);
  const res = NextResponse.json({ ok: true, role });
  res.headers.append('Set-Cookie', `${ROLE_COOKIE}=${token}; ${roleCookieAttributes()}`);
  return res;
}
