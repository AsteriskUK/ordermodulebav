import { NextResponse } from 'next/server';
import { isTemuConfigured } from '@/lib/temu-client';

export async function GET() {
  return NextResponse.json({ connected: isTemuConfigured() });
}
