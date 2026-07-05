import { NextRequest, NextResponse } from 'next/server';
import {
  getAmazonCredentials,
  isAmazonConfigured,
  getAmazonAccessToken,
  createOrdersRdt,
  fetchAmazonOrders,
  fetchAmazonOrderItems,
} from '@/lib/amazon-client';

// GET /api/amazon/diagnostics?days=7
//
// Layered health check for Amazon SP-API, mirroring /api/fedex/rate-diagnostics.
// Reports which env is active and which creds are present (booleans only, never
// values), then walks each layer — LWA auth, Restricted Data Token (proves the
// PII role), getOrders, getOrderItems — so you can pinpoint exactly where setup
// breaks. No PII is returned: only booleans/counts about the first sample order.

export async function GET(req: NextRequest) {
  const creds = getAmazonCredentials();
  const config = {
    configured: isAmazonConfigured(),
    clientId: !!process.env.AMAZON_LWA_CLIENT_ID,
    clientSecret: !!process.env.AMAZON_LWA_CLIENT_SECRET,
    refreshToken: !!process.env.AMAZON_REFRESH_TOKEN,
    marketplaceId: creds?.marketplaceId ?? null,
    endpoint: creds?.endpoint ?? null,
  };

  if (!creds) {
    return NextResponse.json({
      config,
      hint: 'Set AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET and AMAZON_REFRESH_TOKEN in .env.local, then restart.',
    });
  }

  // Layer 1 — LWA auth.
  try {
    await getAmazonAccessToken();
  } catch (e) {
    return NextResponse.json({
      config,
      auth: { ok: false, error: e instanceof Error ? e.message : String(e) },
      hint: 'LWA token exchange failed. Check the client id/secret and that the refresh token belongs to this app.',
    });
  }

  // Layer 2 — Restricted Data Token (proves the PII / Direct-to-Consumer role).
  let ordersToken: string;
  let rdt: { ok: boolean; error?: string };
  try {
    ordersToken = await createOrdersRdt();
    rdt = { ok: true };
  } catch (e) {
    ordersToken = await getAmazonAccessToken();
    rdt = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Layer 3 — getOrders (+ a peek at whether PII actually came back inline).
  const { searchParams } = new URL(req.url);
  const daysBack = parseInt(searchParams.get('days') || '7', 10);
  const createdAfter = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  try {
    const page = await fetchAmazonOrders({ createdAfter, token: ordersToken });
    const orders = page.Orders ?? [];
    const first = orders[0];

    // Layer 4 — getOrderItems for the first order.
    let items: { ok: boolean; count?: number; error?: string } | null = null;
    if (first) {
      try {
        const it = await fetchAmazonOrderItems(first.AmazonOrderId);
        items = { ok: true, count: it.length };
      } catch (e) {
        items = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return NextResponse.json({
      config,
      auth: { ok: true },
      rdt,
      orders: {
        ok: true,
        count: orders.length,
        window: `last ${daysBack} days`,
        // PII presence without exposing values — confirms the RDT/PII role works.
        firstOrder: first
          ? { status: first.OrderStatus ?? null, hasShippingAddress: !!first.ShippingAddress, hasBuyerName: !!first.BuyerInfo?.BuyerName }
          : null,
      },
      items,
      hint: !rdt.ok
        ? 'Orders work but the RDT failed — buyer name/address will be blank. Your app likely lacks the PII (Direct-to-Consumer Shipping) role.'
        : (first && !first.ShippingAddress)
        ? 'RDT succeeded but no address came back — confirm the PII role is approved for this app.'
        : undefined,
    });
  } catch (e) {
    return NextResponse.json({
      config,
      auth: { ok: true },
      rdt,
      orders: { ok: false, error: e instanceof Error ? e.message : String(e) },
      hint: 'Auth worked but getOrders failed. Check the marketplace id and that the Orders API role is authorized for this app.',
    });
  }
}
