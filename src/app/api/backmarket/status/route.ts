import { NextResponse } from 'next/server';
import { isBackmarketConfigured, getBackmarketApiToken, getBackmarketCredentials } from '@/lib/backmarket-api';

export async function GET() {
  const source = getBackmarketApiToken() ? 'token' : getBackmarketCredentials() ? 'credentials' : 'missing';
  return NextResponse.json({
    connected: isBackmarketConfigured(),
    source,
  });
}
