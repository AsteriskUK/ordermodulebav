import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/supabase-admin';
import { makeRoleToken, roleCookieAttributes, ROLE_COOKIE } from '@/lib/auth-cookie';
import { isDomainAllowed } from '@/lib/auth-allow';
import { AppUser, UserRole } from '@/lib/types';

// POST /api/auth/session  { accessToken }
// Step 2 of email-OTP sign-in. The browser has just verified the OTP and holds a
// Supabase session; it sends the access token here. The server re-verifies the
// token with Supabase (so identity can't be spoofed), maps the verified email to
// an app `users` row, and mints the signed HttpOnly role cookie that the proxy
// and read-only guard trust. Returns the resolved app user for the client store.
export async function POST(req: Request) {
  const { accessToken } = await req.json().catch(() => ({})) as { accessToken?: string };
  if (!accessToken) return NextResponse.json({ error: 'no_token' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: { user }, error } = await authClient.auth.getUser(accessToken);
  if (error || !user?.email) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }
  const email = user.email.toLowerCase();

  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('users')
    .select('*')
    .ilike('email', email)
    .eq('is_active', true)
    .maybeSingle();

  let row = existing;
  if (!row) {
    // No pre-existing row: only allow-listed domains may self-provision. Anyone
    // else who somehow obtained a token (they can't, without a code) is refused.
    if (!isDomainAllowed(email)) {
      return NextResponse.json({ error: 'not_authorized' }, { status: 403 });
    }
    const provisioned = {
      id: crypto.randomUUID(),
      name: (user.user_metadata?.full_name as string) || email.split('@')[0],
      email,
      role: 'staff',
      roles: ['staff'],
      department: null,
      departments: [],
      is_active: true,
    };
    const { data: created, error: cErr } = await svc.from('users').insert(provisioned).select('*').single();
    if (cErr || !created) {
      console.error('[auth/session] provision failed', cErr?.message);
      return NextResponse.json({ error: 'provision_failed' }, { status: 500 });
    }
    row = created;
  }

  const role = (row.role ?? 'staff') as UserRole;
  const appUser: AppUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role,
    roles: row.roles || [role],
    department: row.department ?? undefined,
    departments: row.departments || (row.department ? [row.department] : []),
    signature: row.signature ?? undefined,
  };

  const token = await makeRoleToken(row.id, role);
  const res = NextResponse.json({ ok: true, user: appUser, role });
  res.headers.append('Set-Cookie', `${ROLE_COOKIE}=${token}; ${roleCookieAttributes()}`);
  return res;
}
