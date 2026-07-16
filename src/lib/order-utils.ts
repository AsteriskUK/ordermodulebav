import { Order } from './types';

export type OrderUrgency = 'overdue' | 'express' | 'due-soon' | 'normal';

/**
 * Determine visual urgency of an order based on delivery type and post-by date.
 * - Overdue / express → red
 * - Due within 2 days → amber
 * - Normal / completed → no special coloring
 */
export function getOrderUrgency(order: Order): OrderUrgency {
  const completedStatuses = ['shipped', 'delivered', 'cancelled', 'refunded', 'returned', 'archived'];
  if (completedStatuses.includes(order.status)) return 'normal';

  if (order.deliveryType === 'express') return 'express';

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const postBy = order.postByDate ? new Date(order.postByDate) : null;
  if (postBy) {
    postBy.setHours(0, 0, 0, 0);
    if (postBy < now) return 'overdue';
    const diffDays = (postBy.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 2) return 'due-soon';
  }

  return 'normal';
}

/** Tailwind row class for an order based on urgency. */
export function getOrderRowClass(order: Order): string {
  const urgency = getOrderUrgency(order);
  switch (urgency) {
    case 'overdue':
    case 'express':
      return 'bg-red-50 border-l-4 border-red-500';
    case 'due-soon':
      return 'bg-amber-50 border-l-4 border-amber-500';
    default:
      return '';
  }
}

/** Human readable urgency label. */
export function getOrderUrgencyLabel(order: Order): string | null {
  const urgency = getOrderUrgency(order);
  switch (urgency) {
    case 'overdue': return 'Overdue';
    case 'express': return 'Express';
    case 'due-soon': return 'Due soon';
    default: return null;
  }
}

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

// Per-platform invoice branding — so an eBay invoice is visibly different from
// an Amazon one (name, accent colour, and the right order-reference label).
const INVOICE_BRANDS: Record<OrderPlatform, { name: string; color: string; refLabel: string }> = {
  ebay:       { name: 'eBay',        color: '#b45309', refLabel: 'eBay Order' },
  amazon:     { name: 'Amazon',      color: '#c2410c', refLabel: 'Amazon Order ID' },
  backmarket: { name: 'Back Market', color: '#0f766e', refLabel: 'Back Market Order' },
  onbuy:      { name: 'OnBuy',       color: '#0e7490', refLabel: 'OnBuy Order' },
  temu:       { name: 'Temu',        color: '#7e22ce', refLabel: 'Temu Order' },
  manual:     { name: 'Direct Sale', color: '#334155', refLabel: 'Order' },
};

/** Build printable invoice HTML for one or more orders. */
export function buildInvoicesHtml(orders: Order[]): string {
  const pages = orders.map((o) => {
    const platform = getOrderPlatform(o);
    const brand = INVOICE_BRANDS[platform];
    const orderRef = platform === 'amazon' ? (o.amazonOrderId || o.orderNumber || o.salesRecordNumber) : o.salesRecordNumber;
    return `
    <div class="invoice" style="border-top:6px solid ${brand.color};">
      <div class="header" style="border-bottom-color:${brand.color};">
        <div>
          <div class="title">INVOICE / PACKING SLIP</div>
          <div class="platform" style="color:${brand.color};">${brand.name} order</div>
        </div>
        <div class="ref">
          <span class="platform-badge" style="background:${brand.color};">${brand.name}</span><br/>
          ${brand.refLabel} #${orderRef}
          ${platform === 'amazon' && o.salesRecordNumber && o.salesRecordNumber !== orderRef ? `<br/><span class="subref">Ref ${o.salesRecordNumber}</span>` : ''}
          ${platform === 'ebay' && o.orderNumber && o.orderNumber !== o.salesRecordNumber ? `<br/><span class="subref">eBay order ${o.orderNumber}</span>` : ''}
        </div>
      </div>
      <div class="section">
        <div class="col">
          <p class="label">Ship To</p>
          <p><strong>${o.postToName}</strong></p>
          <p>${o.postToAddress1}</p>
          ${o.postToAddress2 ? `<p>${o.postToAddress2}</p>` : ''}
          <p>${o.postToCity}${o.postToCounty ? ', ' + o.postToCounty : ''}</p>
          <p>${o.postToPostcode}</p>
          ${o.postToCountry && o.postToCountry !== 'United Kingdom' ? `<p>${o.postToCountry}</p>` : ''}
        </div>
        <div class="col">
          <p class="label">Order Details</p>
          <p>Sale Date: ${o.saleDate || o.paidOnDate || '—'}</p>
          <p>Sold via: ${brand.name}</p>
          ${o.customLabel ? `<p>SKU: ${o.customLabel}</p>` : ''}
          ${o.trackingNumber ? `<p>Tracking: ${o.trackingNumber}</p>` : ''}
        </div>
      </div>
      <table>
        <thead><tr><th>Item</th><th>Variation</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          <tr>
            <td>${o.itemTitle}</td>
            <td>${o.variation || '—'}</td>
            <td>${o.quantity}</td>
            <td>£${o.soldFor.toFixed(2)}</td>
            <td>£${(o.soldFor * o.quantity).toFixed(2)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3"></td><td>Postage</td><td>£${o.postageAndPackaging.toFixed(2)}</td></tr>
          <tr class="total"><td colspan="3"></td><td>Total</td><td>£${o.totalPrice.toFixed(2)}</td></tr>
        </tfoot>
      </table>
      ${o.buyerNote ? `<div class="note"><strong>Buyer Note:</strong> ${o.buyerNote}</div>` : ''}
    </div>`;
  });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Invoices</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; color:#111; }
    .invoice { padding:20px; max-width:18cm; margin:0 auto; page-break-after:always; }
    .invoice:last-child { page-break-after:auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111; padding-bottom:10px; margin-bottom:14px; }
    .title { font-size:18px; font-weight:bold; }
    .platform { font-size:11px; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }
    .ref { font-size:13px; color:#555; text-align:right; }
    .platform-badge { display:inline-block; color:#fff; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:3px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:3px; }
    .subref { font-size:10px; color:#999; }
    .section { display:flex; gap:30px; margin-bottom:16px; }
    .col { flex:1; }
    .col p { line-height:1.6; }
    p.label { font-weight:bold; text-transform:uppercase; font-size:9px; color:#888; margin-bottom:4px; }
    table { width:100%; border-collapse:collapse; margin-bottom:12px; }
    th, td { border:1px solid #ccc; padding:5px 7px; text-align:left; font-size:11px; }
    th { background:#f0f0f0; font-weight:bold; }
    tfoot td { border-top:1px solid #999; }
    tr.total td { font-weight:bold; }
    .note { background:#fffbe6; border:1px solid #f0c040; padding:8px; border-radius:4px; font-size:11px; }
    @media print { body { margin:0; } }
  </style></head><body>${pages.join('')}</body></html>`;
}

/** Open a print window with HTML content. */
export function printHtml(html: string): void {
  if (typeof window === 'undefined') return;
  const win = window.open('', '_blank');
  if (!win) { console.error('Pop-up blocked'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}
