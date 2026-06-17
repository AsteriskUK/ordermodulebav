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

  // eBay spec: SHA-256 of challengeCode + verificationToken + endpoint
  const hashInput = challengeCode + verificationToken + endpoint;
  const challengeResponse = crypto
    .createHash('sha256')
    .update(hashInput)
    .digest('hex');

  console.log('[eBay Challenge] challengeCode:', challengeCode);
  console.log('[eBay Challenge] verificationToken length:', verificationToken.length);
  console.log('[eBay Challenge] endpoint:', endpoint);
  console.log('[eBay Challenge] hashInput:', hashInput);
  console.log('[eBay Challenge] challengeResponse:', challengeResponse);

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
