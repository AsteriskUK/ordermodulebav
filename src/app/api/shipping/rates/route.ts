import { NextRequest, NextResponse } from 'next/server';
import { Order } from '@/lib/types';
import { estimateDpdCost } from '@/lib/shipping-rates';
import { getFedExRate } from '@/lib/fedex-client';
import { buildFedExShipmentPayload } from '@/lib/fedex-payload';

// Estimated label cost per order for the Batch Shipping cost column.
// DPD comes from a configurable rate card (no live account-rate API);
// FedEx comes from the live Rate API. Failures are reported per-order so one
// bad quote never blocks the rest.

export interface RateResult {
  orderId: string;
  carrier: string;
  amount: number | null;
  currency: string;
  source: 'fedex_live' | 'dpd_card';
  estimated: boolean;   // true = rate card / not a live booked price
  error?: string;
}

export async function POST(req: NextRequest) {
  const { orders } = (await req.json()) as { orders: Order[] };
  if (!orders?.length) {
    return NextResponse.json({ error: 'No orders provided' }, { status: 400 });
  }

  const shipDate = new Date().toISOString().slice(0, 10);
  const fedexConfigured = !!process.env.FEDEX_CLIENT_ID && !!process.env.FEDEX_CLIENT_SECRET && !!process.env.FEDEX_ACCOUNT_NUMBER;

  const rates: RateResult[] = await Promise.all(
    orders.map(async (order): Promise<RateResult> => {
      const carrier = order.deliveryCarrier || 'FedEx';

      if (carrier === 'DPD') {
        return {
          orderId: order.id,
          carrier,
          amount: estimateDpdCost(order.deliveryService, order.numberOfBoxes ?? 1),
          currency: 'GBP',
          source: 'dpd_card',
          estimated: true,
        };
      }

      if (carrier === 'FedEx') {
        if (!fedexConfigured) {
          return { orderId: order.id, carrier, amount: null, currency: 'GBP', source: 'fedex_live', estimated: true, error: 'FedEx not configured' };
        }
        try {
          const rate = await getFedExRate(buildFedExShipmentPayload(order, shipDate));
          return {
            orderId: order.id,
            carrier,
            amount: rate?.amount ?? null,
            currency: rate?.currency ?? 'GBP',
            source: 'fedex_live',
            estimated: true,
            error: rate ? undefined : 'No rate returned',
          };
        } catch (e) {
          return { orderId: order.id, carrier, amount: null, currency: 'GBP', source: 'fedex_live', estimated: true, error: e instanceof Error ? e.message : String(e) };
        }
      }

      // Other carriers (Royal Mail, Parcelforce, Other) have no rate source here.
      return { orderId: order.id, carrier, amount: null, currency: 'GBP', source: 'dpd_card', estimated: true, error: 'No rate source for carrier' };
    })
  );

  return NextResponse.json({ rates });
}
