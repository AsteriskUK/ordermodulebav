import { Order } from './types';
import { useOrderStore } from './store';
import { getOrderPlatform } from './order-utils';
import { resolveSetting, asBool, asList, asString } from './settings';

// Auto-book carrier labels for newly fetched orders — BOOK ONLY. The label PDFs
// are stored on the order and printed at the packing stage; the tracking number
// is messaged to the buyer straight away as an order note. Tracking is only
// uploaded to eBay as a shipping fulfilment when the order actually ships from
// the warehouse (see pushMarketplaceFulfillment in the store).

interface ShipResult {
  orderId: string;
  salesRecordNumber?: string;
  trackingNumber?: string;
  parcelNumber?: string;
  consignmentNumber?: string;
  labelBase64?: string;
  allLabels?: string[];
  labelPdfs?: string[];
  labelHtmls?: string[];
}

function isBookable(o: Order, carriers: string[]): boolean {
  return !o.trackingNumber
    && !(o.labelData?.length)
    && o.deliveryType !== 'collection'
    && carriers.includes(o.deliveryCarrier)
    && !!o.postToAddress1 && !!o.postToPostcode;
}

/** Book labels for any bookable orders in the list. Returns how many were booked. */
export async function autoBookLabels(orders: Order[]): Promise<number> {
  const settings = useOrderStore.getState().appSettings;
  if (!asBool(resolveSetting(settings, 'autobook.enabled'))) return 0;

  const carriers = asList(resolveSetting(settings, 'autobook.carriers'));
  const dpdService = asString(resolveSetting(settings, 'shipping.defaultDpdService'));
  const bookable = orders.filter((o) => isBookable(o, carriers));
  if (bookable.length === 0) return 0;

  const { updateOrderTracking, saveOrderLabels } = useOrderStore.getState();
  const shipDate = new Date().toISOString().slice(0, 10);
  let booked = 0;

  const batches: Array<[Order[], string, Record<string, unknown>]> = [
    [bookable.filter((o) => o.deliveryCarrier === 'DPD'), '/api/dpd/create-shipment', { collectionDate: shipDate, service: dpdService }],
    [bookable.filter((o) => o.deliveryCarrier === 'FedEx'), '/api/fedex/create-shipment', { shipDate }],
  ];

  for (const [batch, endpoint, extra] of batches) {
    if (batch.length === 0) continue;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: batch, ...extra }),
      });
      // 503 = carrier credentials not configured — skip quietly, Batch Shipping
      // remains the manual fallback.
      if (!res.ok) { console.warn('[auto-book]', endpoint, 'status', res.status); continue; }
      const data = await res.json() as { succeeded?: ShipResult[]; failed?: { orderId: string; error: string }[] };

      for (const s of data.succeeded ?? []) {
        const order = batch.find((o) => o.id === s.orderId);
        if (!order) continue;
        const tracking = s.trackingNumber || s.parcelNumber || s.consignmentNumber || '';
        const labels = s.labelHtmls?.length ? s.labelHtmls
          : s.labelPdfs?.length ? s.labelPdfs
          : s.allLabels?.length ? s.allLabels
          : s.labelBase64 ? [s.labelBase64] : [];
        if (labels.length > 0) saveOrderLabels(order.id, order.deliveryCarrier, labels);
        if (tracking) {
          updateOrderTracking(order.id, tracking);
          booked++;
          notifyBuyerTracking(order, tracking).catch((e) => console.warn('[auto-book] buyer note failed', order.salesRecordNumber, e));
        }
      }
      (data.failed ?? []).forEach((f) => console.warn('[auto-book] booking failed', f.orderId, f.error));
    } catch (e) {
      console.error('[auto-book]', endpoint, e);
    }
  }
  return booked;
}

// Share the tracking number with the buyer as an order message (visible in
// their eBay messages) — NOT as a fulfilment; that only happens on dispatch.
// Amazon SP-API doesn't allow proactive free-text messages, so eBay only.
async function notifyBuyerTracking(order: Order, tracking: string): Promise<void> {
  const settings = useOrderStore.getState().appSettings;
  if (!asBool(resolveSetting(settings, 'autobook.notifyBuyer'))) return;
  if (getOrderPlatform(order) !== 'ebay' || !order.buyerUsername) return;

  const firstName = (order.postToName || order.buyerName || '').split(' ')[0] || order.buyerUsername;
  const text = asString(resolveSetting(settings, 'autobook.buyerMessageTemplate'))
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{buyerName\}/g, order.buyerName || order.postToName || '')
    .replace(/\{orderNumber\}/g, order.salesRecordNumber)
    .replace(/\{tracking\}/g, tracking)
    .replace(/\{carrier\}/g, order.deliveryCarrier || '')
    .replace(/\{itemTitle\}/g, order.itemTitle || '');
  const res = await fetch('/api/ebay/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: order.orderNumber || order.salesRecordNumber,
      itemId: order.itemNumber || undefined,
      recipientUsername: order.buyerUsername,
      buyerName: order.buyerName,
      itemTitle: order.itemTitle,
      contactReason: 'TRACKING',
      text,
      sentByName: 'Auto (label booking)',
      automated: true,   // keep the buyer's message unread until a human replies
    }),
  });
  if (!res.ok) console.warn('[auto-book] buyer tracking note failed', order.salesRecordNumber, res.status);
}
