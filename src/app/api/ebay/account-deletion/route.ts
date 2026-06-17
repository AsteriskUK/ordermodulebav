import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get('challenge_code');

  if (!challengeCode) {
    return NextResponse.json({ error: 'Missing challenge_code' }, { status: 400 });
  }

  const verificationToken = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT;

  if (!verificationToken || !endpoint) {
    return NextResponse.json(
      { error: 'eBay account deletion endpoint is not configured' },
      { status: 500 }
    );
  }

  const challengeResponse = crypto
    .createHash('sha256')
    .update(challengeCode + verificationToken + endpoint)
    .digest('hex');

  return NextResponse.json({ challengeResponse });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    console.log('[eBay Account Deletion Notification]', {
      notificationId: body?.notification?.notificationId,
      eventDate: body?.notification?.eventDate,
      userId: body?.notification?.data?.userId,
      eiasToken: body?.notification?.data?.eiasToken,
      topic: body?.metadata?.topic,
    });

    // TODO: queue anonymisation of stored eBay buyer data matching userId/eiasToken

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[eBay Account Deletion Notification] Error:', error);
    return new NextResponse(null, { status: 204 });
  }
}
