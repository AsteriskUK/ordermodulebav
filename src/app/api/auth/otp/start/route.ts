import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/supabase-admin';
import { isDomainAllowed } from '@/lib/auth-allow';

// POST /api/auth/otp/start  { email }
// Step 1 of email-OTP sign-in. Authorizes the address BEFORE sending, so a code
// is only ever emailed to a known staff member (or an allow-listed domain) —
// never to an arbitrary address a stranger types in. Returns { ok: true } once
// the 6-digit code has been sent; the browser then verifies it directly.
export async function POST(req: Request) {
  const { email: rawEmail } = await req.json().catch(() => ({})) as { email?: string };
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'bad_email' }, { status: 400 });
  }

  // Authorize first — a code is never sent to a non-staff address.
  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('users')
    .select('id')
    .ilike('email', email)
    .eq('is_active', true)
    .maybeSingle();

  if (!existing && !isDomainAllowed(email)) {
    return NextResponse.json(
      { error: 'not_authorized', message: 'This email is not set up for access. Ask an administrator to add you.' },
      { status: 403 },
    );
  }

  // Send the code with an anon auth client (service-role can't do OTP sign-in).
  // shouldCreateUser lets a first-time staff member get a Supabase auth identity;
  // authorization above is what keeps that from being abused.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await authClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    console.error('[auth/otp/start] send failed', error.message);
    return NextResponse.json({ error: 'send_failed', message: error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
