import { NextRequest, NextResponse } from 'next/server';
import { verifyRoleToken, ROLE_COOKIE } from '@/lib/auth-cookie';

// ============================================================================
// WRITE-BLOCKING PROXY (read-only 'viewer' enforcement)
// ----------------------------------------------------------------------------
// Every mutating API request (POST/PUT/PATCH/DELETE to /api/*) is checked here.
// If the signed role cookie says the caller is a 'viewer', the write is refused
// with 403 — enforced by the server, so it holds even if the browser UI is
// tampered with.
//
// The rule:
//   • No cookie at all      → allowed (fail-open for staff who signed in before
//                             this shipped, and for server-to-server calls).
//   • Valid viewer cookie   → blocked.
//   • Cookie present but it
//     fails verification     → blocked. A tampered payload (e.g. role flipped to
//                             admin) breaks the HMAC, so this closes the obvious
//                             escape; an expired cookie lands here too and the
//                             user simply re-signs-in.
// The remaining residual — a viewer who opens devtools to delete their own
// HttpOnly cookie, or calls the raw DB via the anon key — is the pre-existing,
// app-wide anon-key exposure, explicitly out of scope for this app-level boundary.
// ============================================================================

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Endpoints a viewer must still be able to call to sign in and hold a session.
const EXEMPT_PREFIXES = ['/api/auth/', '/api/session'];

function deny() {
  return NextResponse.json(
    { error: 'read_only', message: 'This is a read-only account. Changes are not permitted.' },
    { status: 403 },
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) return NextResponse.next();
  if (!WRITE_METHODS.has(req.method)) return NextResponse.next();
  if (EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const raw = req.cookies.get(ROLE_COOKIE)?.value;
  if (!raw) return NextResponse.next();            // no cookie → fail open

  const token = await verifyRoleToken(raw);
  if (!token) return deny();                       // present but tampered/expired → block
  if (token.role === 'viewer') return deny();      // read-only account → block
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
