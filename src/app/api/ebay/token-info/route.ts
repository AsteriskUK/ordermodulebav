import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Temporary helper — visit /api/ebay/token-info after OAuth to copy your refresh_token.
 * Once you've added EBAY_REFRESH_TOKEN to .env.local you can delete this file.
 */
export async function GET() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('ebay_refresh_token')?.value;
  const expiresAt = cookieStore.get('ebay_token_expires_at')?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token in cookies. Complete the OAuth flow first via /api/ebay/auth' }, { status: 404 });
  }

  return NextResponse.json({
    refresh_token: refreshToken,
    access_token_expires_at: expiresAt ? new Date(Number(expiresAt)).toISOString() : null,
    instruction: 'Copy refresh_token into .env.local as EBAY_REFRESH_TOKEN, then delete this file.',
  });
}
