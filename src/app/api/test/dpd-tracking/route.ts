import { NextRequest, NextResponse } from 'next/server';
import { trackDPDShipment, probeDpdTracking } from '@/lib/dpd-client';

/**
 * Test endpoint for DPD tracking API
 * GET /api/test/dpd-tracking?number=123456789
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trackingNumber = searchParams.get('number');

  if (!trackingNumber) {
    return NextResponse.json(
      { success: false, error: 'Missing tracking number. Use ?number=YOUR_TRACKING_NUMBER' },
      { status: 400 }
    );
  }

  // ?probe=1 → try candidate tracking endpoints and report each status.
  if (request.nextUrl.searchParams.get('probe') === '1') {
    const probe = await probeDpdTracking(trackingNumber);
    return NextResponse.json({ success: true, trackingNumber, probe });
  }

  try {
    console.log(`[TEST] Calling DPD tracking API for: ${trackingNumber}`);
    const result = await trackDPDShipment(trackingNumber);
    console.log(`[TEST] DPD tracking response:`, JSON.stringify(result, null, 2));
    return NextResponse.json({ success: true, trackingNumber, result });
  } catch (error) {
    console.error(`[TEST] DPD tracking call failed:`, error);
    return NextResponse.json(
      {
        success: false,
        trackingNumber,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
