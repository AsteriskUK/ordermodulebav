import Papa from 'papaparse';
import { Order, DeliveryCarrier, DeliveryType } from './types';
import { deriveCategory } from './categoriser';

export function deriveShipping(postcode: string, totalPrice: number, postageAndPackaging: number): { deliveryCarrier: DeliveryCarrier; deliveryType: DeliveryType } {
  const upper = postcode.trim().toUpperCase();
  const isBT = upper.startsWith('BT');

  // Postage paid in CSV = customer paid for express shipping
  if (postageAndPackaging > 0) {
    return { deliveryCarrier: 'DPD', deliveryType: 'express' };
  }
  // BT postcode (Northern Ireland) = DPD next day, no extra charge
  if (isBT) {
    return { deliveryCarrier: 'DPD', deliveryType: 'next_day' };
  }
  // Orders < £400 go FedEx standard
  if (totalPrice < 400) {
    return { deliveryCarrier: 'FedEx', deliveryType: 'standard' };
  }
  // £400–£999: DPD pre-12 (standard)
  if (totalPrice < 1000) {
    return { deliveryCarrier: 'DPD', deliveryType: 'standard' };
  }
  // ≥ £1000: DPD next day
  return { deliveryCarrier: 'DPD', deliveryType: 'next_day' };
}

/** Returns DPD service code (col X) and liability flag (col Y) based on order value */
function dpdServiceAndLiability(totalPrice: number, postageAndPackaging: number, postcode: string): { serviceCode: string; liability: string } {
  const isBT = postcode.trim().toUpperCase().startsWith('BT');
  // express (paid postage) or ≥£1000 = next day service 12
  if (postageAndPackaging > 0 || totalPrice >= 1000) {
    return { serviceCode: '12', liability: totalPrice >= 1000 ? 'Y' : 'N' };
  }
  // BT or £400–£999: pre-12 service 13
  if (isBT || totalPrice >= 400) {
    return { serviceCode: '13', liability: 'N' };
  }
  return { serviceCode: '12', liability: 'N' };
}

// eBay CSV export format (tab-separated from eBay File Exchange / Seller Hub)
interface EbayCSVRow {
  'Sales record number': string;
  'Order number': string;
  'Buyer username': string;
  'Buyer name': string;
  'Buyer email': string;
  'Buyer note': string;
  'Buyer address 1': string;
  'Buyer address 2': string;
  'Buyer city': string;
  'Buyer county': string;
  'Buyer postcode': string;
  'Buyer country': string;
  'Post to name': string;
  'Post to phone': string;
  'Post to address 1': string;
  'Post to address 2': string;
  'Post to city': string;
  'Post to county': string;
  'Post to postcode': string;
  'Post to country': string;
  'Item number': string;
  'Item title': string;
  'Custom label': string;
  'Quantity': string;
  'Sold for': string;
  'Postage and packaging': string;
  'Total price': string;
  'Sale date': string;
  'Paid on date': string;
  'Post by date': string;
  'Dispatched on date': string;
  'Delivery service': string;
  'Tracking number': string;
  'Variation details': string;
  [key: string]: string;
}

// Amazon CSV export format (tab-separated)
interface AmazonCSVRow {
  'order-id': string;
  'order-item-id': string;
  'purchase-date': string;
  'payments-date': string;
  'promise-date': string;
  'buyer-email': string;
  'buyer-name': string;
  'buyer-phone-number': string;
  'sku': string;
  'product-name': string;
  'quantity-purchased': string;
  'quantity-shipped': string;
  'quantity-to-ship': string;
  'ship-service-level': string;
  'recipient-name': string;
  'ship-address-1': string;
  'ship-address-2': string;
  'ship-address-3': string;
  'ship-city': string;
  'ship-state': string;
  'ship-postal-code': string;
  'ship-country': string;
  'is-business-order': string;
  [key: string]: string;
}

// Temu CSV export format (comma-separated)
interface TemuCSVRow {
  'Order ID': string;
  'order status': string;
  'Order item ID': string;
  'order item status': string;
  'product name by customer order': string;
  'product name': string;
  'variation': string;
  'contribution sku': string;
  'SKU ID': string;
  'quantity purchased': string;
  'quantity shipped': string;
  'recipient name': string;
  'recipient phone number': string;
  'ship address 1': string;
  'ship address 2': string;
  'ship address 3': string;
  'ship city': string;
  'ship state': string;
  'ship postal code (Must be shipped to the following zip code.)': string;
  'ship country': string;
  'purchase date': string;
  'latest shipping time': string;
  'virtual email': string;
  'goods base price': string;
  'retail price total': string;
  'shipping cost': string;
  'tracking number': string;
  'carrier': string;
  [key: string]: string;
}

// OnBuy CSV export format (comma-separated with quotes)
interface OnBuyCSVRow {
  'Order Number': string;
  'Order Date': string;
  'Site': string;
  'Customer': string;
  'Delivery Address Name': string;
  'Delivery Address Line 1': string;
  'Delivery Address Line 2': string;
  'Delivery Address Line 3': string;
  'Delivery Address Town': string;
  'Delivery Address County': string;
  'Delivery Address Postcode': string;
  'Delivery Address Country': string;
  'Product Name': string;
  'OPC': string;
  'SKU': string;
  'Condition Name': string;
  'Selected Options': string;
  'Quantity': string;
  'Product Unit Price': string;
  'Product Total': string;
  'Expected Dispatch': string;
  'Delivery By': string;
  'Delivery Service': string;
  'Status': string;
  'Order Subtotal': string;
  'Total Delivery': string;
  'Order Total': string;
  [key: string]: string;
}

// BackMarket CSV export format (semicolon separated)
interface BackMarketCSVRow {
  order_id: string;
  orderline_title: string;
  sku: string;
  quantity: string;
  order_price: string;
  shipping_price: string;
  shipping_first_name: string;
  shipping_last_name: string;
  shipping_street: string;
  shipping_street2: string;
  shipping_postal_code: string;
  shipping_city: string;
  shipping_country: string;
  shipping_phone: string;
  shipping_email: string;
  customer_email: string;
  date_creation: string;
  date_payment: string;
  date_shipping: string;
  tracking_number: string;
  shipper: string;
  model: string;
  brand: string;
  category3: string;
  order_state: string;
  orderline_state: string;
  [key: string]: string;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function safeFloat(val: string | undefined | null): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function safeInt(val: string | undefined | null): number {
  if (!val) return 1;
  const num = parseInt(val, 10);
  return isNaN(num) ? 1 : num;
}

function detectFormat(content: string): 'ebay' | 'backmarket' | 'amazon' | 'temu' | 'onbuy' {
  const firstLine = content.split('\n')[0];
  if (firstLine.includes('order_id') && firstLine.includes(';')) return 'backmarket';
  if (firstLine.includes('order-id') && firstLine.includes('buyer-email')) return 'amazon';
  if (firstLine.includes('Order ID') && firstLine.includes('recipient name') && firstLine.includes('virtual email')) return 'temu';
  if (firstLine.includes('Order Number') && firstLine.includes('Delivery Address Name')) return 'onbuy';
  return 'ebay';
}

function parseEbayCSV(content: string, batchId: string): Order[] {
  const result = Papa.parse<EbayCSVRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors);
  }

  // eBay CSV: multi-item orders have address/name/postcode only on the FIRST row.
  // Carry forward context fields from the previous row when blank.
  type RowContext = {
    salesRecordNumber: string;
    orderNumber: string;
    buyerUsername: string;
    buyerName: string;
    buyerEmail: string;
    postToName: string;
    postToPhone: string;
    postToAddress1: string;
    postToAddress2: string;
    postToCity: string;
    postToCounty: string;
    postToPostcode: string;
    postToCountry: string;
    postByDate: string;
    saleDate: string;
    paidOnDate: string;
    deliveryService: string;
    totalPrice: number;
    postageAndPackaging: number;
  };

  let ctx: RowContext | null = null;

  return result.data
    .filter((row) => row['Sales record number'] || row['Order number'] || (ctx && row['Item title']))
    .map((row): Order => {
      const salesRecordNumber = row['Sales record number'] || ctx?.salesRecordNumber || '';
      const orderNumber = row['Order number'] || ctx?.orderNumber || '';

      // If this row has a fresh salesRecordNumber (or it's the first row), reset context
      if (row['Sales record number'] && row['Sales record number'] !== ctx?.salesRecordNumber) {
        ctx = {
          salesRecordNumber: row['Sales record number'] || '',
          orderNumber: row['Order number'] || '',
          buyerUsername: row['Buyer username'] || '',
          buyerName: row['Buyer name'] || '',
          buyerEmail: row['Buyer email'] || '',
          postToName: row['Post to name'] || '',
          postToPhone: row['Post to phone'] || '',
          postToAddress1: row['Post to address 1'] || '',
          postToAddress2: row['Post to address 2'] || '',
          postToCity: row['Post to city'] || '',
          postToCounty: row['Post to county'] || '',
          postToPostcode: row['Post to postcode'] || '',
          postToCountry: row['Post to country'] || '',
          postByDate: row['Post by date'] || '',
          saleDate: row['Sale date'] || row['Paid on date'] || '',
          paidOnDate: row['Paid on date'] || '',
          deliveryService: row['Delivery service'] || '',
          totalPrice: safeFloat(row['Total price']),
          postageAndPackaging: safeFloat(row['Postage and packaging']),
        };
      }

      // Use row value if present, otherwise fall back to carried-forward context
      const postToAddress1 = row['Post to address 1'] || ctx?.postToAddress1 || '';
      const postToPostcode = row['Post to postcode'] || ctx?.postToPostcode || '';
      const totalPrice = safeFloat(row['Total price']) || ctx?.totalPrice || 0;
      const postageAndPackaging = safeFloat(row['Postage and packaging']) || ctx?.postageAndPackaging || 0;

      return {
        id: generateUUID(),
        salesRecordNumber,
        orderNumber,
        buyerUsername: row['Buyer username'] || ctx?.buyerUsername || '',
        buyerName: row['Buyer name'] || ctx?.buyerName || '',
        buyerEmail: row['Buyer email'] || ctx?.buyerEmail || '',
        buyerNote: row['Buyer note'] || '',
        postToName: row['Post to name'] || ctx?.postToName || '',
        postToPhone: row['Post to phone'] || ctx?.postToPhone || '',
        postToAddress1,
        postToAddress2: row['Post to address 2'] || ctx?.postToAddress2 || '',
        postToCity: row['Post to city'] || ctx?.postToCity || '',
        postToCounty: row['Post to county'] || ctx?.postToCounty || '',
        postToPostcode,
        postToCountry: row['Post to country'] || ctx?.postToCountry || '',
        itemNumber: row['Item number'] || '',
        itemTitle: row['Item title'] || '',
        customLabel: row['Custom label'] || '',
        variation: row['Variation details'] || '',
        quantity: safeInt(row['Quantity']),
        soldFor: safeFloat(row['Sold for']),
        postageAndPackaging,
        totalPrice,
        priority: 5,
        numberOfBoxes: 1,
        saleDate: row['Sale date'] || ctx?.saleDate || '',
        paidOnDate: row['Paid on date'] || ctx?.paidOnDate || '',
        postByDate: row['Post by date'] || ctx?.postByDate || '',
        dispatchedOnDate: row['Dispatched on date'] || '',
        deliveryService: row['Delivery service'] || ctx?.deliveryService || '',
        trackingNumber: row['Tracking number'] || '',
        ...deriveShipping(postToPostcode, totalPrice, postageAndPackaging),
        status: row['Dispatched on date'] ? 'shipped' : 'pending',
        category: deriveCategory(row['Item title'] || ''),
        comments: '',
        labelQty: 1,
        isGSP: postToPostcode.toUpperCase().startsWith('WS11') ||
               !!(row['Post to country'] && row['Post to country'] !== 'United Kingdom' && row['Post to country'] !== 'GB'),
        importedAt: new Date().toISOString(),
        batchId,
      };
    });
}

function parseBackMarketCSV(content: string, batchId: string): Order[] {
  const result = Papa.parse<BackMarketCSVRow>(content, {
    header: true,
    skipEmptyLines: true,
    delimiter: ';',
    quoteChar: '"',
    transformHeader: (h) => h.trim().replace(/^"/, '').replace(/"$/, ''),
  });

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors);
  }

  return result.data
    .filter((row) => row.order_id)
    .map((row): Order => {
      const orderState = row.order_state;
      let status: Order['status'] = 'pending';
      if (orderState === '9' || row.date_shipping) status = 'shipped';
      else if (orderState === '3') status = 'pending';
      else if (orderState === '4') status = 'cancelled';

      return {
        id: generateUUID(),
        salesRecordNumber: row.order_id || '',
        orderNumber: row.order_id || '',
        buyerUsername: '',
        buyerName: `${row.shipping_first_name || ''} ${row.shipping_last_name || ''}`.trim(),
        buyerEmail: row.customer_email || '',
        buyerNote: '',
        postToName: `${row.shipping_first_name || ''} ${row.shipping_last_name || ''}`.trim(),
        postToPhone: row.shipping_phone || '',
        postToAddress1: row.shipping_street || '',
        postToAddress2: row.shipping_street2 || '',
        postToCity: row.shipping_city || '',
        postToCounty: '',
        postToPostcode: row.shipping_postal_code || '',
        postToCountry: row.shipping_country || '',
        itemNumber: row.sku || '',
        itemTitle: row.orderline_title || '',
        customLabel: row.sku || '',
        variation: '',
        quantity: safeInt(row.quantity),
        soldFor: safeFloat(row.order_price),
        postageAndPackaging: safeFloat(row.shipping_price),
        totalPrice: safeFloat(row.order_price),
        priority: 5, // Default to lowest priority
        numberOfBoxes: 1, // Default to 1 box
        saleDate: row.date_creation || '',
        paidOnDate: row.date_payment || '',
        postByDate: '',
        dispatchedOnDate: row.date_shipping || '',
        deliveryService: row.shipper || '',
        trackingNumber: row.tracking_number || '',
        ...deriveShipping(row.shipping_postal_code || '', safeFloat(row.order_price), safeFloat(row.shipping_price)),
        status,
        category: deriveCategory(row.orderline_title || row.category3 || ''),
        comments: '',
        labelQty: 1,
        isGSP: !!(row.shipping_country && row.shipping_country !== 'GB' && row.shipping_country !== 'United Kingdom'),
        importedAt: new Date().toISOString(),
        batchId,
      };
    });
}

function parseAmazonCSV(content: string, batchId: string): Order[] {
  const result = Papa.parse<AmazonCSVRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length > 0) console.warn('Amazon CSV warnings:', result.errors);

  return result.data
    .filter((row) => row['order-id'])
    .map((row): Order => {
      const postcode = (row['ship-postal-code'] || '').trim().toUpperCase();
      // Amazon order reports do not include item price — set 0 (update manually or via another report)
      const price = safeFloat(row['item-price'] || row['product-price'] || '0');
      const shipping = safeFloat(row['shipping-price'] || '0');
      const totalPrice = price + shipping;
      return {
        id: generateUUID(),
        salesRecordNumber: row['order-item-id'] || row['order-id'] || '',
        orderNumber: row['order-id'] || '',
        buyerUsername: '',
        buyerName: row['buyer-name'] || '',
        buyerEmail: row['buyer-email'] || '',
        buyerNote: '',
        postToName: row['recipient-name'] || row['buyer-name'] || '',
        postToPhone: row['buyer-phone-number'] || '',
        postToAddress1: row['ship-address-1'] || '',
        postToAddress2: [row['ship-address-2'], row['ship-address-3']].filter(Boolean).join(', '),
        postToCity: row['ship-city'] || '',
        postToCounty: row['ship-state'] || '',
        postToPostcode: postcode,
        postToCountry: row['ship-country'] === 'GB' ? 'United Kingdom' : (row['ship-country'] || 'United Kingdom'),
        itemNumber: row['sku'] || '',
        itemTitle: row['product-name'] || '',
        customLabel: row['sku'] || '',
        variation: '',
        quantity: safeInt(row['quantity-purchased']),
        soldFor: price,
        postageAndPackaging: shipping,
        totalPrice,
        priority: 5,
        numberOfBoxes: 1,
        saleDate: row['purchase-date'] || '',
        paidOnDate: row['payments-date'] || '',
        postByDate: row['promise-date'] || '',
        dispatchedOnDate: '',
        deliveryService: row['ship-service-level'] || '',
        trackingNumber: '',
        ...deriveShipping(postcode, totalPrice, shipping),
        status: safeInt(row['quantity-shipped']) > 0 ? 'shipped' : 'pending',
        category: deriveCategory(row['product-name'] || ''),
        comments: '',
        labelQty: 1,
        isGSP: !!(row['ship-country'] && row['ship-country'] !== 'GB'),
        importedAt: new Date().toISOString(),
        batchId,
      };
    });
}

function parseTemuCSV(content: string, batchId: string): Order[] {
  const result = Papa.parse<TemuCSVRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (result.errors.length > 0) console.warn('Temu CSV warnings:', result.errors);

  return result.data
    .filter((row) => row['Order ID'] || row['Order item ID'])
    .map((row): Order => {
      const postcode = (row['ship postal code (Must be shipped to the following zip code.)'] || '').trim().toUpperCase();
      const price = safeFloat(row['retail price total'] || row['goods base price']);
      const shipping = safeFloat(row['shipping cost']);
      const totalPrice = price;
      const itemTitle = row['product name by customer order'] || row['product name'] || '';
      const isShipped = (row['order item status'] || '').toLowerCase().includes('ship');
      return {
        id: generateUUID(),
        salesRecordNumber: row['Order item ID'] || row['Order ID'] || '',
        orderNumber: row['Order ID'] || '',
        buyerUsername: '',
        buyerName: row['recipient name'] || '',
        buyerEmail: row['virtual email'] || '',
        buyerNote: '',
        postToName: row['recipient name'] || '',
        postToPhone: row['recipient phone number'] || '',
        postToAddress1: row['ship address 1'] || '',
        postToAddress2: [row['ship address 2'], row['ship address 3']].filter(Boolean).join(', '),
        postToCity: row['ship city'] || '',
        postToCounty: row['ship state'] || '',
        postToPostcode: postcode,
        postToCountry: row['ship country'] === 'GB' ? 'United Kingdom' : (row['ship country'] || 'United Kingdom'),
        itemNumber: row['SKU ID'] || row['contribution sku'] || '',
        itemTitle,
        customLabel: row['contribution sku'] || '',
        variation: row['variation'] || '',
        quantity: safeInt(row['quantity purchased']),
        soldFor: price,
        postageAndPackaging: shipping,
        totalPrice,
        priority: 5,
        numberOfBoxes: 1,
        saleDate: row['purchase date'] || '',
        paidOnDate: row['purchase date'] || '',
        postByDate: row['latest shipping time'] || '',
        dispatchedOnDate: '',
        deliveryService: row['carrier'] || '',
        trackingNumber: row['tracking number'] || '',
        ...deriveShipping(postcode, totalPrice, shipping),
        status: isShipped ? 'shipped' : 'pending',
        category: deriveCategory(itemTitle),
        comments: '',
        labelQty: 1,
        isGSP: !!(row['ship country'] && row['ship country'] !== 'United Kingdom' && row['ship country'] !== 'GB'),
        importedAt: new Date().toISOString(),
        batchId,
      };
    });
}

function parseOnBuyCSV(content: string, batchId: string): Order[] {
  const result = Papa.parse<OnBuyCSVRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().replace(/^"|"$/g, ''),
  });
  if (result.errors.length > 0) console.warn('OnBuy CSV warnings:', result.errors);

  return result.data
    .filter((row) => row['Order Number'])
    .map((row): Order => {
      // Customer field may be "Name, +44phone" — split on last comma
      const customerRaw = row['Customer'] || '';
      const phoneMatch = customerRaw.match(/,\s*(\+?[\d\s]+)$/);
      const phone = phoneMatch ? phoneMatch[1].trim() : '';
      const postcode = (row['Delivery Address Postcode'] || '').trim().toUpperCase();
      const price = safeFloat(row['Product Total'] || row['Product Unit Price']);
      const shipping = safeFloat(row['Total Delivery']);
      const totalPrice = safeFloat(row['Order Total']) || price + shipping;
      const isShipped = (row['Status'] || '').toLowerCase() === 'dispatched';
      return {
        id: generateUUID(),
        salesRecordNumber: row['Order Number'] || '',
        orderNumber: row['Order Number'] || '',
        buyerUsername: '',
        buyerName: row['Delivery Address Name'] || '',
        buyerEmail: '',
        buyerNote: '',
        postToName: row['Delivery Address Name'] || '',
        postToPhone: phone,
        postToAddress1: row['Delivery Address Line 1'] || '',
        postToAddress2: [row['Delivery Address Line 2'], row['Delivery Address Line 3']].filter(Boolean).join(', '),
        postToCity: row['Delivery Address Town'] || '',
        postToCounty: row['Delivery Address County'] || '',
        postToPostcode: postcode,
        postToCountry: row['Delivery Address Country'] || 'United Kingdom',
        itemNumber: row['SKU'] || row['OPC'] || '',
        itemTitle: row['Product Name'] || '',
        customLabel: row['SKU'] || '',
        variation: row['Selected Options'] || '',
        quantity: safeInt(row['Quantity']),
        soldFor: price,
        postageAndPackaging: shipping,
        totalPrice,
        priority: 5,
        numberOfBoxes: 1,
        saleDate: row['Order Date'] || '',
        paidOnDate: row['Order Date'] || '',
        postByDate: row['Expected Dispatch'] || '',
        dispatchedOnDate: isShipped ? row['Order Date'] : '',
        deliveryService: row['Delivery Service'] || '',
        trackingNumber: '',
        ...deriveShipping(postcode, totalPrice, shipping),
        status: isShipped ? 'shipped' : 'pending',
        category: deriveCategory(row['Product Name'] || ''),
        comments: '',
        labelQty: 1,
        isGSP: !!(row['Delivery Address Country'] && row['Delivery Address Country'] !== 'United Kingdom' && row['Delivery Address Country'] !== 'GB'),
        importedAt: new Date().toISOString(),
        batchId,
      };
    });
}

export function parseCSV(content: string, batchId: string): { orders: Order[]; format: 'ebay' | 'backmarket' | 'amazon' | 'temu' | 'onbuy' } {
  const format = detectFormat(content);
  let orders: Order[];
  switch (format) {
    case 'backmarket': orders = parseBackMarketCSV(content, batchId); break;
    case 'amazon':     orders = parseAmazonCSV(content, batchId);     break;
    case 'temu':       orders = parseTemuCSV(content, batchId);       break;
    case 'onbuy':      orders = parseOnBuyCSV(content, batchId);      break;
    default:           orders = parseEbayCSV(content, batchId);       break;
  }
  return { orders, format };
}

export interface BundleGroup {
  buyerUsername: string;
  buyerName: string;
  orders: Order[];
}

export function groupOrdersByBuyer(orders: Order[]): BundleGroup[] {
  const map = new Map<string, BundleGroup>();
  for (const order of orders) {
    // Use salesRecordNumber as last-resort so orders with no buyer info don't collapse into one group
    const key = order.buyerUsername || order.buyerEmail || order.postToName || order.salesRecordNumber;
    if (!map.has(key)) {
      map.set(key, { buyerUsername: key, buyerName: order.postToName || order.buyerName || key, orders: [] });
    }
    map.get(key)!.orders.push(order);
  }
  return Array.from(map.values()).sort((a, b) => b.orders.length - a.orders.length);
}

export function generateBundledShipCSV(groups: BundleGroup[]): string {
  const headers = [
    'shipmentReference',
    'recipientContactName',
    'recipientCompany',
    'recipientContactNumber',
    'recipientLine1',
    'recipientLine2',
    'recipientLine3',
    'recipientPostcode',
    'recipientCity',
    'recipientState',
    'recipientCountry',
    'recipientEmail',
    'itemCount',
    'orderRefs',
  ];

  const rows = groups.map((group) => {
    const rep = group.orders[0];
    const refs = group.orders.map((o) => o.salesRecordNumber).join(' | ');
    return [
      refs,
      rep.postToName,
      '',
      rep.postToPhone,
      rep.postToAddress1,
      rep.postToAddress2,
      rep.postToCity,
      rep.postToPostcode,
      rep.postToCity,
      rep.postToCounty,
      rep.postToCountry === 'United Kingdom' ? 'GB' : rep.postToCountry,
      rep.buyerEmail,
      String(group.orders.reduce((sum, o) => sum + o.quantity, 0)),
      refs,
    ];
  });

  return Papa.unparse({ fields: headers, data: rows });
}

export function generateBatchShipCSV(orders: Order[]): string {
  const headers = [
    'shipmentReference',
    'recipientContactName',
    'recipientCompany',
    'recipientContactNumber',
    'recipientLine1',
    'recipientLine2',
    'recipientLine3',
    'recipientPostcode',
    'recipientCity',
    'recipientState',
    'recipientCountry',
    'recipientEmail',
  ];

  const rows = orders.map((order) => [
    order.salesRecordNumber,
    order.postToName,
    '',
    order.postToPhone,
    order.postToAddress1,
    order.postToAddress2,
    order.postToCity,
    order.postToPostcode,
    order.postToCity,
    order.postToCounty,
    order.postToCountry === 'United Kingdom' ? 'GB' : order.postToCountry,
    order.buyerEmail,
  ]);

  return Papa.unparse({
    fields: headers,
    data: rows,
  });
}

export function generateDPDCSV(orders: Order[]): string {
  // Exclude collection orders
  const exportOrders = orders.filter((o) => o.deliveryType !== 'collection');

  // Exact column layout from DPD portal screenshot:
  // A: shipmentRef | B-I: blanks (8 cols) | J: contactName | K: phone |
  // L: address1 | M: address2 | N: city | O: postcode | P: city | Q: county |
  // R: country | S: email | T: date | U: parcels(Z) | V: serviceCode(X) | W: liability(Y)
  const headers = [
    'shipmentRef',
    '', '', '', '', '', '', '', '', // 8 blank filler columns (B-I)
    'contactName',
    'contactPhone',
    'address1',
    'address2',
    'city',
    'postcode',
    'city2',
    'county',
    'country',
    'email',
    'dispatchDate',
    'numberOfParcels', // Column Z
    'serviceCode',     // Column X: 12=Next Day, 13=Pre-12
    'extendedLiability', // Column Y: Y or N
  ];

  const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '/');

  const rows = exportOrders.map((order) => {
    const { serviceCode, liability } = dpdServiceAndLiability(
      order.totalPrice,
      order.postageAndPackaging,
      order.postToPostcode
    );
    return [
      order.salesRecordNumber,
      '', '', '', '', '', '', '', '', // 8 blank filler columns
      order.postToName,
      order.postToPhone || '',
      order.postToAddress1,
      order.postToAddress2 || '',
      order.postToCity,
      order.postToPostcode,
      order.postToCity,
      order.postToCounty || '',
      order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
      order.buyerEmail || '',
      today,
      (order.numberOfBoxes ?? 1).toString(), // col Z
      serviceCode,                            // col X
      liability,                              // col Y
    ];
  });

  return Papa.unparse([headers, ...rows], { header: false });
}

export function generateFedExCSV(orders: Order[]): string {
  // Exclude collection orders
  const exportOrders = orders.filter((o) => o.deliveryType !== 'collection');

  // Exact column layout from FedEx Bulk Upload screenshot:
  // shipmentRef | s(x8 blanks) | recipientContactName | recipientContactPhone |
  // recipientCompany | recipientLine1 | recipientLine2 | recipientLine3 |
  // recipientPostcode | recipientCity | recipientState | recipientCountry | recipientEmail
  const headers = [
    'shipmentRef',
    '', '', '', '', '', '', '', '', // 8 blank filler columns
    'recipientContactName',
    'recipientContactPhone',
    'recipientCompany',
    'recipientLine1',
    'recipientLine2',
    'recipientLine3',
    'recipientPostcode',
    'recipientCity',
    'recipientState',
    'recipientCountry',
    'recipientEmail',
  ];

  const rows = exportOrders.map((order) => [
    order.salesRecordNumber,
    '', '', '', '', '', '', '', '', // 8 blank filler columns
    order.postToName,
    order.postToPhone || '',
    '', // company
    order.postToAddress1,
    order.postToAddress2 || '',
    order.postToCity,
    order.postToPostcode,
    order.postToCity,
    order.postToCounty || '',
    order.postToCountry === 'United Kingdom' ? 'GB' : (order.postToCountry || 'GB'),
    order.buyerEmail || '',
  ]);

  return Papa.unparse([headers, ...rows], { header: false });
}

export function generateDPDBundleCSV(groups: BundleGroup[]): string {
  // Exclude collection orders from each group
  const filteredGroups = groups
    .map((g) => ({ ...g, orders: g.orders.filter((o) => o.deliveryType !== 'collection') }))
    .filter((g) => g.orders.length > 0);

  const headers = [
    'shipmentRef',
    '', '', '', '', '', '', '', '',
    'contactName',
    'contactPhone',
    'address1',
    'address2',
    'city',
    'postcode',
    'city2',
    'county',
    'country',
    'email',
    'dispatchDate',
    'numberOfParcels',
    'serviceCode',
    'extendedLiability',
  ];

  const today = new Date().toLocaleDateString('en-GB').replace(/\//g, '/');

  const rows: string[][] = [];
  for (const group of filteredGroups) {
    if (!group.orders[0].postToName && !group.orders[0].postToAddress1) continue;
    const rep = group.orders[0];
    const totalValue = group.orders.reduce((sum, o) => sum + o.totalPrice, 0);
    const totalBoxes = group.orders.reduce((sum, o) => sum + (o.numberOfBoxes ?? 1), 0);
    const totalPostage = group.orders.reduce((sum, o) => sum + o.postageAndPackaging, 0);
    const { serviceCode, liability } = dpdServiceAndLiability(totalValue, totalPostage, rep.postToPostcode);

    group.orders.forEach((order, i) => {
      if (i === 0) {
        // First order: full address row
        rows.push([
          order.salesRecordNumber,
          '', '', '', '', '', '', '', '',
          rep.postToName,
          rep.postToPhone || '',
          rep.postToAddress1,
          rep.postToAddress2 || '',
          rep.postToCity,
          rep.postToPostcode,
          rep.postToCity,
          rep.postToCounty || '',
          rep.postToCountry === 'United Kingdom' ? 'GB' : (rep.postToCountry || 'GB'),
          rep.buyerEmail || '',
          today,
          totalBoxes.toString(),
          serviceCode,
          liability,
        ]);
      } else {
        // Subsequent orders: shipmentRef only, rest blank
        rows.push([
          order.salesRecordNumber,
          '', '', '', '', '', '', '', '',
          '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        ]);
      }
    });
  }

  return Papa.unparse([headers, ...rows], { header: false });
}

export function generateFedExBundleCSV(groups: BundleGroup[]): string {
  // Exclude collection orders from each group
  const filteredGroups = groups
    .map((g) => ({ ...g, orders: g.orders.filter((o) => o.deliveryType !== 'collection') }))
    .filter((g) => g.orders.length > 0);

  const headers = [
    'shipmentRef',
    '', '', '', '', '', '', '', '',
    'recipientContactName',
    'recipientContactPhone',
    'recipientCompany',
    'recipientLine1',
    'recipientLine2',
    'recipientLine3',
    'recipientPostcode',
    'recipientCity',
    'recipientState',
    'recipientCountry',
    'recipientEmail',
  ];

  const rows: string[][] = [];
  for (const group of filteredGroups) {
    if (!group.orders[0].postToName && !group.orders[0].postToAddress1) continue;
    const rep = group.orders[0];

    group.orders.forEach((order, i) => {
      if (i === 0) {
        // First order: full address row
        rows.push([
          order.salesRecordNumber,
          '', '', '', '', '', '', '', '',
          rep.postToName,
          rep.postToPhone || '',
          '', // company
          rep.postToAddress1,
          rep.postToAddress2 || '',
          rep.postToCity,
          rep.postToPostcode,
          rep.postToCity,
          rep.postToCounty || '',
          rep.postToCountry === 'United Kingdom' ? 'GB' : (rep.postToCountry || 'GB'),
          rep.buyerEmail || '',
        ]);
      } else {
        // Subsequent orders: shipmentRef only, rest blank
        rows.push([
          order.salesRecordNumber,
          '', '', '', '', '', '', '', '',
          '', '', '', '', '', '', '', '', '', '', '',
        ]);
      }
    });
  }

  return Papa.unparse([headers, ...rows], { header: false });
}

export function generateCarrierBundleCSV(groups: BundleGroup[], carrier: string): string {
  switch (carrier.toLowerCase()) {
    case 'dpd':
      return generateDPDBundleCSV(groups);
    case 'fedex':
      return generateFedExBundleCSV(groups);
    default:
      return generateBundledShipCSV(groups);
  }
}

export function generateEmailLabelsCSV(orders: Order[]): string {
  // Exclude GSP orders and add today's date in column W
  const nonGSPOrders = orders.filter(order => !order.isGSP);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
  
  const headers = [
    'Order Number',
    'Customer Name',
    'Address Line 1',
    'Address Line 2',
    'City',
    'Postcode',
    'Country',
    'Item Title',
    'Quantity',
    'SKU',
    'Tracking Number',
    'Service',
    'Status',
    'Email Sent Date', // Column W
    'Notes'
  ];

  const rows = nonGSPOrders.map((order) => [
    order.salesRecordNumber,
    order.postToName,
    order.postToAddress1,
    order.postToAddress2 || '',
    order.postToCity,
    order.postToPostcode,
    order.postToCountry,
    order.itemTitle,
    order.quantity.toString(),
    order.customLabel || '',
    order.trackingNumber || '',
    order.deliveryService || '',
    order.status,
    today, // Column W - today's date
    order.buyerNote || ''
  ]);

  return Papa.unparse({
    fields: headers,
    data: rows,
  });
}

export function generateCarrierCSV(orders: Order[], carrier: string): string {
  switch (carrier.toLowerCase()) {
    case 'dpd':
      return generateDPDCSV(orders);
    case 'fedex':
      return generateFedExCSV(orders);
    default:
      return generateBatchShipCSV(orders);
  }
}
