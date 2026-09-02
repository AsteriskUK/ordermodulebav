// ============================================================================
// SIGN-IN AUTHORIZATION (email allow-list)
// ----------------------------------------------------------------------------
// Email OTP by itself would let ANY address that can receive mail request a
// code. Authorization is what makes it safe: a code is only ever sent to — and
// a session only ever minted for — an address that is either
//   • an existing active row in the `users` table (admin-provisioned), or
//   • on an allow-listed company domain (AUTH_ALLOWED_DOMAINS), in which case
//     the person is auto-provisioned as a basic staff member for an admin to
//     configure.
// Both checks run server-side (service-role), so the browser can't bypass them.
// ============================================================================

/** Domains that may self-provision, from AUTH_ALLOWED_DOMAINS (comma-separated). */
export function allowedDomains(): string[] {
  return (process.env.AUTH_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** The domain part of an email, lower-cased ('' if malformed). */
export function emailDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase();
}

/** Is this email on an allow-listed domain? */
export function isDomainAllowed(email: string): boolean {
  const domains = allowedDomains();
  return domains.length > 0 && domains.includes(emailDomain(email));
}
