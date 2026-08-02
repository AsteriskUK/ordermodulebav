import { Order } from './types';
import { getOrderPlatform, type OrderPlatform } from './order-platform';
import { useOrderStore } from './store';
import { resolveSetting, asString, asNumber, asBool } from './settings';

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

// Lives in order-platform.ts (store-free) and is re-exported here so existing
// importers keep working.
export { getOrderPlatform } from './order-platform';
export type { OrderPlatform } from './order-platform';

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

// Invoice-time configuration (Settings → Business / Printing). This module is
// only used client-side, so it reads the store directly; every value falls back
// to its registry default when nothing is stored.
function invoiceConfig() {
  const values = useOrderStore.getState().appSettings;
  return {
    sellerName: asString(resolveSetting(values, 'business.tradingName')),
    vatRate: asNumber(resolveSetting(values, 'business.vatRatePercent')),
    footer: asString(resolveSetting(values, 'invoice.footerText')),
    showBuyerNote: asBool(resolveSetting(values, 'invoice.showBuyerNote')),
    showSku: asBool(resolveSetting(values, 'invoice.showSku')),
    useMarketplaceTemplates: asBool(resolveSetting(values, 'invoice.useMarketplaceTemplates')),
    legalName: asString(resolveSetting(values, 'business.legalName')),
    companyNumber: asString(resolveSetting(values, 'business.companyNumber')),
    vatRegistered: asBool(resolveSetting(values, 'business.vatRegistered')),
    vatNumber: asString(resolveSetting(values, 'business.vatNumber')),
    supportEmail: asString(resolveSetting(values, 'business.supportEmail')),
    supportPhone: asString(resolveSetting(values, 'business.supportPhone')),
    currency: asString(resolveSetting(values, 'business.currency')),
    ebayStoreUrl: asString(resolveSetting(values, 'business.ebayStoreUrl')),
    address1: asString(resolveSetting(values, 'business.address1')),
    address2: asString(resolveSetting(values, 'business.address2')),
    city: asString(resolveSetting(values, 'business.city')),
    county: asString(resolveSetting(values, 'business.county')),
    postcode: asString(resolveSetting(values, 'business.postcode')),
    country: asString(resolveSetting(values, 'business.country')),
  };
}

/** Symbol for a currency code, used across invoices and dashboards. */
export function currencySymbol(code: string): string {
  return ({ GBP: '£', EUR: '€', USD: '$' } as Record<string, string>)[code] ?? '£';
}

/**
 * Legal footer assembled from the Business settings — company details buyers
 * and tax authorities expect on an invoice. Omits anything not configured.
 */
function businessFooterHtml(cfg: ReturnType<typeof invoiceConfig>): string {
  const parts: string[] = [];
  const name = cfg.legalName || cfg.sellerName;
  if (name) parts.push(name);
  if (cfg.companyNumber) parts.push(`Company No. ${cfg.companyNumber}`);
  if (cfg.vatRegistered && cfg.vatNumber) parts.push(`VAT No. ${cfg.vatNumber}`);
  const contact = [cfg.supportEmail, cfg.supportPhone].filter(Boolean).join(' · ');
  const lines = [parts.join(' · '), contact, cfg.footer].filter(Boolean);
  return lines.length ? `<p class="inv-footer">${lines.join('<br/>')}</p>` : '';
}

const AMAZON_DELIVERY_SERVICE: Record<string, string> = {
  standard: 'Standard', next_day: 'Next Day', two_day: 'Two Day', express: 'Expedited', collection: 'Collection',
};

// Amazon packing slip — matches the official Amazon Marketplace slip layout:
// "Dispatch to" block, dashed rule, Order ID + thank-you line, the bordered
// delivery/order-details box, the Quantity/Product Details/Unit price/Order
// Totals table (VAT-inclusive figures), grand total and the Amazon footer.
function buildAmazonSlipPage(o: Order): string {
  const cfg = invoiceConfig();
  const orderId = o.amazonOrderId || o.orderNumber || o.salesRecordNumber;
  const orderDate = o.saleDate
    ? new Date(o.saleDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  // Prefer Amazon's own shipment service (stored on the order) over our derived type.
  const service = (o.deliveryService && o.deliveryService.trim())
    || AMAZON_DELIVERY_SERVICE[o.deliveryType] || 'Standard';
  const qty = o.quantity || 1;
  const unitPrice = o.soldFor / qty;
  const itemSubtotal = o.soldFor;
  const grandTotal = o.totalPrice || o.soldFor;
  // Prices are VAT-inclusive — show the VAT portion at the configured rate.
  const vat = (n: number) => (cfg.vatRate <= 0 ? 0 : n - n / (1 + cfg.vatRate / 100));
  const sym = currencySymbol(cfg.currency);
  const gbp = (n: number) => `${sym}${n.toFixed(2)}`;
  const addressLines = [
    o.postToName,
    o.postToAddress1,
    o.postToAddress2,
    o.postToCity,
    o.postToCounty,
    o.postToPostcode,
    o.postToCountry || 'United Kingdom',
  ].filter((l): l is string => !!l && l.trim() !== '');

  return `
    <div class="invoice amz">
      <table class="amz-details">
        <tr>
          <td class="amz-details-address" rowspan="4">
            <p><strong>Delivery address:</strong></p>
            ${addressLines.map((l) => `<p>${l}</p>`).join('')}
          </td>
          <td class="amz-details-label">Order Date:</td>
          <td>${orderDate}</td>
        </tr>
        <tr><td class="amz-details-label">Delivery Service:</td><td>${service}</td></tr>
        <tr><td class="amz-details-label">Buyer Name:</td><td>${o.buyerName || o.buyerUsername || '—'}</td></tr>
        <tr><td class="amz-details-label">Seller Name:</td><td>${cfg.sellerName}</td></tr>
      </table>
      <p class="amz-dispatch-label">Dispatch to:</p>
      <div class="amz-dispatch">${addressLines.map((l) => `<p>${l}</p>`).join('')}</div>
      <div class="amz-dash"></div>
      <p class="amz-order-id">Order ID: ${orderId}</p>
      <p class="amz-thanks">Thank you for buying from ${cfg.sellerName} on Amazon Marketplace.</p>
      <table class="amz-items">
        <thead>
          <tr>
            <th class="amz-c">Quantity</th>
            <th class="amz-c">Quantity Included</th>
            <th>Product Details</th>
            <th>Unit price</th>
            <th class="amz-c">Order Totals</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="amz-c amz-top">${qty}</td>
            <td class="amz-c amz-top">${qty}</td>
            <td class="amz-top">
              <p class="amz-item-title">${o.itemTitle}</p>
              ${o.variation ? `<p><strong>Variation:</strong> ${o.variation}</p>` : ''}
              ${o.customLabel ? `<p><strong>SKU:</strong> ${o.customLabel}</p>` : ''}
              ${o.itemNumber ? `<p><strong>ASIN:</strong> ${o.itemNumber}</p>` : ''}
              <p><strong>Condition:</strong> New</p>
            </td>
            <td class="amz-top">${gbp(unitPrice)}</td>
            <td class="amz-top amz-r">
              <table class="amz-totals">
                <tr><td></td><td></td><td class="amz-vat-head">Included VAT</td></tr>
                <tr class="amz-rule"><td><strong>Item subtotal</strong></td><td>${gbp(itemSubtotal)}</td><td>${gbp(vat(itemSubtotal))}</td></tr>
                ${o.postageAndPackaging > 0 ? `<tr class="amz-rule"><td><strong>Postage &amp; Packing</strong></td><td>${gbp(o.postageAndPackaging)}</td><td>${gbp(vat(o.postageAndPackaging))}</td></tr>` : ''}
                <tr class="amz-rule"><td><strong>Item total</strong></td><td><strong>${gbp(grandTotal)}</strong></td><td><strong>${gbp(vat(grandTotal))}</strong></td></tr>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="amz-grand">Grand total: ${gbp(grandTotal)}</p>
      ${o.buyerNote ? `<div class="note"><strong>Buyer Note:</strong> ${o.buyerNote}</div>` : ''}
      <p class="amz-footer">
        <strong>Thanks for buying on Amazon Marketplace.</strong> To provide feedback for the seller please visit
        <span class="amz-link">www.amazon.co.uk/feedback</span>. To contact the seller, go to Your Orders in Your Account. Click the seller's name under the
        appropriate product. Then, in the "Further Information" section, click "Contact the Seller."
      </p>
      <div class="amz-dash"></div>
    </div>`;
}

// eBay invoice / packing slip — matches eBay's own layout: the eBay wordmark and
// "INVOICE/PACKING SLIP" header, centred store name + URL (with a QR), the three
// address blocks (Post to / Post from / Buyer registration address), buyer
// contact line, order ref + date, the item table (Item / Quantity / Item price /
// VAT rate / Item total), the postage-service line, and the seller message +
// totals breakdown (Subtotal/Postage excl. VAT, Discount, VAT amount, Order total).
function buildEbayInvoicePage(o: Order, cfg: ReturnType<typeof invoiceConfig>, sym: string): string {
  const gbp = (n: number) => `${sym}${n.toFixed(2)}`;
  const esc = (s?: string) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const orderDate = o.saleDate
    ? new Date(o.saleDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const shipLines = [o.postToAddress1, o.postToAddress2, [o.postToCity, o.postToCounty].filter(Boolean).join(', '),
    o.postToPostcode, o.postToCountry || 'United Kingdom'].filter((l): l is string => !!l && l.trim() !== '');
  const sellerLines = [cfg.address1, cfg.address2, [cfg.city, cfg.county].filter(Boolean).join(', '),
    cfg.postcode, cfg.country || 'United Kingdom'].filter((l): l is string => !!l && l.trim() !== '');
  // Buyer registration address falls back to the shipping address when unknown.
  const regName = o.buyerName || o.postToName;
  const regLines = (o.buyerAddress1 ? [o.buyerAddress1, o.buyerAddress2, [o.buyerCity, o.buyerCounty].filter(Boolean).join(', '),
    o.buyerPostcode, o.buyerCountry] : shipLines).filter((l): l is string => !!l && l.trim() !== '');

  const qty = o.quantity || 1;
  const itemTotal = o.soldFor * qty;
  const postage = o.postageAndPackaging || 0;
  const orderTotal = o.totalPrice || itemTotal + postage;
  const discount = Math.max(0, itemTotal + postage - orderTotal);
  const rate = cfg.vatRegistered ? cfg.vatRate : 0;
  const net = rate > 0 ? orderTotal / (1 + rate / 100) : orderTotal;
  const vatAmount = orderTotal - net;
  const postageNet = rate > 0 ? postage / (1 + rate / 100) : postage;
  const subtotalNet = net - postageNet;

  const service = { standard: 'Standard', next_day: 'Next Day', two_day: 'DPD Two Day', express: 'Express', collection: 'Collection' }[o.deliveryType] || o.deliveryService || 'Standard';
  const specs = [o.customLabel && `CPU/SKU: ${o.customLabel}`, o.variation].filter(Boolean).join('  ');
  const qrSrc = cfg.ebayStoreUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=110x110&margin=0&data=${encodeURIComponent(cfg.ebayStoreUrl)}` : '';

  return `
    <div class="invoice eb">
      <div class="eb-head">
        <div class="eb-logo"><span style="color:#e53238">e</span><span style="color:#0064d2">b</span><span style="color:#f5af02">a</span><span style="color:#86b817">y</span></div>
        <div class="eb-doctype">INVOICE/PACKING SLIP</div>
      </div>
      <div class="eb-store">
        <div class="eb-store-name">${esc(cfg.sellerName)}</div>
        ${cfg.ebayStoreUrl ? `<div class="eb-store-url">${esc(cfg.ebayStoreUrl)}</div>` : ''}
      </div>
      ${qrSrc ? `<div class="eb-qr"><p>Shop QR code link</p><img src="${qrSrc}" alt="QR" width="90" height="90"/></div>` : ''}
      <div class="eb-addrs">
        <div class="eb-addr">
          <p class="eb-h">Post to</p>
          <p><strong>${esc(o.postToName)}</strong></p>
          ${shipLines.map((l) => `<p>${esc(l)}</p>`).join('')}
          <div class="eb-contact">
            ${o.postToPhone ? `<p>${esc(o.postToPhone)}</p>` : ''}
            ${o.buyerEmail ? `<p>${esc(o.buyerEmail)}</p>` : ''}
            ${o.buyerUsername ? `<p>Username: ${esc(o.buyerUsername)}</p>` : ''}
          </div>
        </div>
        <div class="eb-addr">
          <p class="eb-h">Post from</p>
          <p><strong>${esc(cfg.legalName || cfg.sellerName)}</strong></p>
          ${sellerLines.map((l) => `<p>${esc(l)}</p>`).join('')}
          ${cfg.vatRegistered && cfg.vatNumber ? `<p>VAT ID: ${esc(cfg.vatNumber)}</p>` : ''}
        </div>
        <div class="eb-addr">
          <p class="eb-h">Buyer registration address</p>
          <p><strong>${esc(regName)}</strong></p>
          ${regLines.map((l) => `<p>${esc(l)}</p>`).join('')}
        </div>
      </div>
      <div class="eb-orderline">
        <div><span class="eb-order">Order: ${esc(o.orderNumber || o.salesRecordNumber)}</span><br/><span class="eb-sr">Sales record #: ${esc(o.salesRecordNumber)}</span></div>
        <div class="eb-date">Order date: ${orderDate}</div>
      </div>
      <table class="eb-items">
        <thead><tr><th>Item</th><th class="eb-c">Quantity</th><th class="eb-r">Item price</th><th class="eb-c">VAT rate</th><th class="eb-r">Item total</th></tr></thead>
        <tbody>
          <tr>
            <td>
              <p class="eb-item-title">${esc(o.itemTitle)}${o.itemNumber ? ` (Item ID: ${esc(o.itemNumber)})` : ''}</p>
              ${specs ? `<p class="eb-specs">${esc(specs)}</p>` : ''}
            </td>
            <td class="eb-c">${qty}</td>
            <td class="eb-r">${gbp(o.soldFor)}</td>
            <td class="eb-c">${rate}%</td>
            <td class="eb-r">${gbp(itemTotal)}</td>
          </tr>
        </tbody>
      </table>
      <p class="eb-postage">Buyer selected postage service : ${esc(service)}</p>
      <div class="eb-bottom">
        <div class="eb-msg">
          <p><strong>A message from ${esc(cfg.legalName || cfg.sellerName)}</strong></p>
          <p>${esc(cfg.footer) || 'Thanks for your purchase!'}</p>
        </div>
        <table class="eb-totals">
          <tr><td>Subtotal (excl. VAT)</td><td>${gbp(subtotalNet)}</td></tr>
          <tr><td>Postage (excl. VAT)</td><td>${gbp(postageNet)}</td></tr>
          ${discount > 0 ? `<tr><td>Discount</td><td>-${gbp(discount)}</td></tr>` : ''}
          <tr><td>VAT amount</td><td>${gbp(vatAmount)}</td></tr>
          <tr class="eb-total"><td>Order total</td><td>${gbp(orderTotal)}</td></tr>
        </table>
      </div>
    </div>`;
}

/** Build printable invoice HTML for one or more orders. */
export function buildInvoicesHtml(orders: Order[]): string {
  const cfg = invoiceConfig();
  const sym = currencySymbol(cfg.currency);
  const pages = orders.map((o) => {
    const platform = getOrderPlatform(o);
    // Amazon orders print the official Amazon Marketplace packing slip layout
    // (unless marketplace-native templates are switched off in Settings).
    if (platform === 'amazon' && cfg.useMarketplaceTemplates) return buildAmazonSlipPage(o);
    if (platform === 'ebay' && cfg.useMarketplaceTemplates) return buildEbayInvoicePage(o, cfg, sym);
    const brand = INVOICE_BRANDS[platform];
    const orderRef = o.salesRecordNumber;
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
          ${cfg.showSku && o.customLabel ? `<p>SKU: ${o.customLabel}</p>` : ''}
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
            <td>${sym}${o.soldFor.toFixed(2)}</td>
            <td>${sym}${(o.soldFor * o.quantity).toFixed(2)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3"></td><td>Postage</td><td>${sym}${o.postageAndPackaging.toFixed(2)}</td></tr>
          <tr class="total"><td colspan="3"></td><td>Total</td><td>${sym}${o.totalPrice.toFixed(2)}</td></tr>
        </tfoot>
      </table>
      ${cfg.showBuyerNote && o.buyerNote ? `<div class="note"><strong>Buyer Note:</strong> ${o.buyerNote}</div>` : ''}
      ${businessFooterHtml(cfg)}
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
    .inv-footer { margin-top:14px; padding-top:10px; border-top:1px solid #ddd; font-size:10px; color:#666; white-space:pre-wrap; }
    .note { background:#fffbe6; border:1px solid #f0c040; padding:8px; border-radius:4px; font-size:11px; }

    /* ---- Amazon Marketplace packing slip ---- */
    .amz { font-family: Arial, Helvetica, sans-serif; font-size:12px; color:#000; padding-top:16px; }
    .amz p { line-height:1.5; }
    .amz-dispatch-label { font-size:11px; margin-bottom:2px; }
    .amz-dispatch p { font-size:15px; font-weight:bold; line-height:1.35; }
    .amz-dash { border-top:2px dashed #444; margin:14px 0; }
    .amz-order-id { font-size:15px; font-weight:bold; margin-bottom:2px; }
    .amz-thanks { font-size:11px; margin-bottom:10px; }
    .amz-details { width:100%; border:1px solid #000; border-collapse:collapse; margin-bottom:14px; }
    .amz-details td { border:none; padding:3px 10px; font-size:12px; vertical-align:top; }
    .amz-details td:first-child { padding-top:8px; }
    .amz-details tr:first-child td { padding-top:8px; }
    .amz-details tr:last-child td { padding-bottom:8px; }
    .amz-details-address { width:38%; padding-bottom:8px !important; }
    .amz-details-address p { line-height:1.6; }
    .amz-details-label { width:22%; white-space:nowrap; }
    .amz-items { width:100%; border-collapse:collapse; margin-bottom:6px; }
    .amz-items th, .amz-items td { border:1px solid #000; padding:6px 8px; font-size:12px; }
    .amz-items th { background:#fff; font-weight:bold; text-align:left; }
    .amz-items th.amz-c { text-align:center; }
    .amz-c { text-align:center; }
    .amz-r { text-align:right; }
    .amz-top { vertical-align:top; }
    .amz-item-title { font-weight:bold; margin-bottom:6px; }
    .amz-items td p { line-height:1.6; }
    .amz-totals { width:100%; border-collapse:collapse; margin-left:auto; }
    .amz-totals td { border:none !important; padding:2px 4px; font-size:12px; text-align:right; white-space:nowrap; }
    .amz-totals td:first-child { text-align:left; }
    .amz-vat-head { color:#555; }
    .amz-rule td { border-bottom:1px solid #bbb !important; }
    .amz-grand { text-align:right; font-size:13px; font-weight:bold; margin:8px 0 18px; }
    .amz-footer { font-size:11.5px; line-height:1.6; margin-top:6px; }
    .amz-link { color:#0066c0; }

    /* ---- eBay invoice / packing slip ---- */
    .eb { font-family: Arial, Helvetica, sans-serif; font-size:11px; color:#111; position:relative; padding-top:10px; }
    .eb p { line-height:1.5; }
    .eb-head { display:flex; justify-content:space-between; align-items:flex-start; }
    .eb-logo { font-size:34px; font-weight:800; letter-spacing:-1px; font-family: Arial, sans-serif; }
    .eb-doctype { font-size:11px; color:#555; letter-spacing:0.5px; padding-top:8px; }
    .eb-store { text-align:center; margin:-24px 0 8px; }
    .eb-store-name { font-size:16px; font-weight:bold; color:#555; }
    .eb-store-url { font-size:11px; color:#555; margin-top:2px; }
    .eb-qr { position:absolute; top:44px; right:0; text-align:center; }
    .eb-qr p { font-size:10px; color:#555; margin-bottom:3px; }
    .eb-addrs { display:flex; gap:20px; margin-top:18px; padding-right:120px; }
    .eb-addr { flex:1; }
    .eb-h { font-weight:bold; font-size:11px; margin-bottom:5px; }
    .eb-addr p { font-size:11px; line-height:1.45; }
    .eb-contact { margin-top:14px; }
    .eb-contact p { font-size:11px; line-height:1.5; }
    .eb-orderline { display:flex; justify-content:space-between; align-items:flex-start; margin:22px 0 4px; }
    .eb-order { font-size:15px; font-weight:bold; }
    .eb-sr { font-size:11px; color:#555; }
    .eb-date { font-size:12px; }
    .eb-items { width:100%; border-collapse:collapse; margin-top:10px; }
    .eb-items th { border-bottom:1px solid #333; padding:7px 6px; font-size:11px; font-weight:bold; text-align:left; }
    .eb-items td { border-bottom:1px solid #e2e2e2; padding:10px 6px; font-size:11px; vertical-align:top; }
    .eb-items .eb-c { text-align:center; }
    .eb-items .eb-r { text-align:right; }
    .eb-item-title { font-weight:600; line-height:1.4; }
    .eb-specs { color:#555; margin-top:4px; font-size:10.5px; }
    .eb-postage { text-align:right; font-size:11px; margin:10px 0 16px; }
    .eb-bottom { display:flex; justify-content:space-between; gap:30px; }
    .eb-msg { font-size:11px; max-width:9cm; }
    .eb-msg p { line-height:1.5; }
    .eb-totals { border-collapse:collapse; min-width:6.5cm; }
    .eb-totals td { padding:3px 0; font-size:11px; }
    .eb-totals td:last-child { text-align:right; padding-left:30px; }
    .eb-total td { font-weight:bold; font-size:12px; padding-top:6px; }
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
