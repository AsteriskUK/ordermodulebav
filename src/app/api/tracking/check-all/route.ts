import { NextRequest, NextResponse } from 'next/server';
import { checkAllShippedOrders } from '@/lib/tracking-service';

/**
 * API endpoint to check tracking for all shipped orders
 * Can be called by a scheduled job or manually
 * 
 * GET /api/tracking/check-all
 * 
 * Returns:
 * - Array of tracking update results
 * - Summary of delivered/in-transit/error counts
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[API] Starting tracking check for all shipped orders');
    
    const results = await checkAllShippedOrders();
    
    const delivered = results.filter(r => r.status === 'delivered');
    const inTransit = results.filter(r => r.status === 'in_transit');
    const shipped = results.filter(r => r.status === 'shipped');
    const errors = results.filter(r => r.status === 'error');
    
    const summary = {
      total: results.length,
      delivered: delivered.length,
      inTransit: inTransit.length,
      shipped: shipped.length,
      errors: errors.length,
    };
    
    console.log(`[API] Tracking check complete: ${summary.delivered} delivered, ${summary.inTransit} in transit, ${summary.errors} errors`);
    
    return NextResponse.json({
      success: true,
      summary,
      results,
    });
  } catch (error) {
    console.error('[API] Error in tracking check:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint to check tracking for specific order IDs
 * 
 * POST /api/tracking/check-all
 * Body: { orderIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderIds } = body;
    
    if (!Array.isArray(orderIds)) {
      return NextResponse.json(
        { success: false, error: 'orderIds must be an array' },
        { status: 400 }
      );
    }
    
    console.log(`[API] Starting tracking check for ${orderIds.length} specific orders`);
    
    const { checkOrderById } = await import('@/lib/tracking-service');
    const results = [];
    
    for (const orderId of orderIds) {
      const result = await checkOrderById(orderId);
      if (result) {
        results.push(result);
      }
    }
    
    const delivered = results.filter(r => r.status === 'delivered');
    const inTransit = results.filter(r => r.status === 'in_transit');
    const shipped = results.filter(r => r.status === 'shipped');
    const errors = results.filter(r => r.status === 'error');
    
    const summary = {
      total: results.length,
      delivered: delivered.length,
      inTransit: inTransit.length,
      shipped: shipped.length,
      errors: errors.length,
    };
    
    console.log(`[API] Tracking check complete: ${summary.delivered} delivered, ${summary.inTransit} in transit, ${summary.errors} errors`);
    
    return NextResponse.json({
      success: true,
      summary,
      results,
    });
  } catch (error) {
    console.error('[API] Error in tracking check:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}
