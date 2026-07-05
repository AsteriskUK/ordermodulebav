import { NextResponse } from 'next/server';
import { isAmazonConfigured } from '@/lib/amazon-client';

export async function GET() {
  return NextResponse.json({ connected: isAmazonConfigured() });
}
