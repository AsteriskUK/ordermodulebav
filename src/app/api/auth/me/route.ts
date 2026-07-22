import { NextRequest, NextResponse } from 'next/server';
import { verifyRoleToken, ROLE_COOKIE } from '@/lib/auth-cookie';

// GET /api/auth/me — the caller's role from the signed cookie (authoritative).
// The client uses this to decide read-only mode, so enforcement never depends
// on the user record happening to be present/active in the synced users list.
export async function GET(req: NextRequest) {
  const token = await verifyRoleToken(req.cookies.get(ROLE_COOKIE)?.value);
  return NextResponse.json({ role: token?.role ?? null });
}
