import { Order } from './types';

// Kept in its own module (no store import) so code inside the store can resolve an
// order's marketplace without creating a store ⇄ order-utils import cycle.
// order-utils re-exports both symbols, so existing importers are unaffected.

export type OrderPlatform = 'ebay' | 'amazon' | 'backmarket' | 'onbuy' | 'temu' | 'manual';

/** Which marketplace an order came from — by Amazon id pattern, then batch prefix. */
export function getOrderPlatform(order: Order): OrderPlatform {
  const amazonPattern = /^\d{3}-\d{7}-\d{7}$/;
  if (order.amazonOrderId || [order.orderNumber, order.salesRecordNumber].some((v) => v && amazonPattern.test(v))) return 'amazon';
  const prefix = (order.batchId || '').split('-')[0]?.toLowerCase();
  if (['ebay', 'amazon', 'backmarket', 'onbuy', 'temu'].includes(prefix)) return prefix as OrderPlatform;
  // eBay API order numbers look like 12-34567-89012; sales record numbers are short numerics.
  if (/^\d{2}-\d{5}-\d{5}$/.test(order.orderNumber || '')) return 'ebay';
  if (/^\d{4,6}$/.test(order.salesRecordNumber || '')) return 'ebay';
  return 'manual';
}
