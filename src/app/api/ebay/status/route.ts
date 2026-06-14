import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const envToken = process.env.EBAY_REFRESH_TOKEN;
  if (envToken) {
    return NextResponse.json({ connected: true, source: 'env' });
  }

  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('ebay_refresh_token')?.value;
  return NextResponse.json({ connected: !!refreshToken, source: 'cookie' });
}
