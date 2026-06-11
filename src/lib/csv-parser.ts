import Papa from 'papaparse';
import { Order, DeliveryCarrier, DeliveryType } from './types';
import { deriveCategory } from './categoriser';

export function deriveShipping(postcode: string, totalPrice: number, postageAndPackaging: number): { deliveryCarrier: DeliveryCarrier; deliveryType: DeliveryType } {
  const upper = postcode.trim().toUpperCase();
  const isBT = upper.startsWith('BT');
  const paidPostage = postageAndPackaging > 0 || isBT;

  if (paidPostage) {
    return { deliveryCarrier: 'DPD', deliveryType: 'next_day' };
  }
  if (totalPrice > 400) {
    return { deliveryCarrier: 'DPD', deliveryType: 'standard' };
  }
  return { deliveryCarrier: 'FedEx', deliveryType: 'standard' };
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

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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

function detectFormat(content: string): 'ebay' | 'backmarket' {
  const firstLine = content.split('\n')[0];
  if (firstLine.includes('order_id') && firstLine.includes(';')) {
    return 'backmarket';
  }
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

  return result.data
    .filter((row) => row['Sales record number'] || row['Order number'])
    .map((row): Order => ({
      id: generateId(),
      salesRecordNumber: row['Sales record number'] || '',
      orderNumber: row['Order number'] || '',
      buyerUsername: row['Buyer username'] || '',
      buyerName: row['Buyer name'] || '',
      buyerEmail: row['Buyer email'] || '',
      buyerNote: row['Buyer note'] || '',
      postToName: row['Post to name'] || '',
      postToPhone: row['Post to phone'] || '',
      postToAddress1: row['Post to address 1'] || '',
      postToAddress2: row['Post to address 2'] || '',
      postToCity: row['Post to city'] || '',
      postToCounty: row['Post to county'] || '',
      postToPostcode: row['Post to postcode'] || '',
      postToCountry: row['Post to country'] || '',
      itemNumber: row['Item number'] || '',
      itemTitle: row['Item title'] || '',
      customLabel: row['Custom label'] || '',
      variation: row['Variation details'] || '',
      quantity: safeInt(row['Quantity']),
      soldFor: safeFloat(row['Sold for']),
      postageAndPackaging: safeFloat(row['Postage and packaging']),
      totalPrice: safeFloat(row['Total price']),
      priority: 5, // Default to lowest priority
      numberOfBoxes: 1, // Default to 1 box
      saleDate: row['Sale date'] || row['Paid on date'] || '',
      paidOnDate: row['Paid on date'] || '',
      postByDate: row['Post by date'] || '',
      dispatchedOnDate: row['Dispatched on date'] || '',
      deliveryService: row['Delivery service'] || '',
      trackingNumber: row['Tracking number'] || '',
      ...deriveShipping(row['Post to postcode'] || '', safeFloat(row['Total price']), safeFloat(row['Postage and packaging'])),
      status: row['Dispatched on date'] ? 'shipped' : 'pending',
      category: deriveCategory(row['Item title'] || ''),
      comments: '',
      labelQty: 1,
      isGSP: (row['Post to postcode'] || '').toUpperCase().startsWith('WS11') ||
             !!(row['Post to country'] && row['Post to country'] !== 'United Kingdom' && row['Post to country'] !== 'GB'),
      importedAt: new Date().toISOString(),
      batchId,
    }));
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
        id: generateId(),
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

export function parseCSV(content: string, batchId: string): { orders: Order[]; format: 'ebay' | 'backmarket' } {
  const format = detectFormat(content);
  const orders = format === 'ebay'
    ? parseEbayCSV(content, batchId)
    : parseBackMarketCSV(content, batchId);
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
    const key = order.buyerUsername || order.buyerEmail || order.postToName;
    if (!map.has(key)) {
      map.set(key, { buyerUsername: key, buyerName: order.postToName, orders: [] });
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
  const headers = [
    'Reference',
    'Name',
    'Company',
    'Address1',
    'Address2',
    'City',
    'Postcode',
    'Country',
    'Phone',
    'Email',
    'Service Type', // Column X
    'Liability', // Column Y
    'Number of Boxes', // Column Z
    'Weight',
    'Special Instructions',
  ];

  const rows = orders.map((order) => {
    const totalValue = order.totalPrice;
    const serviceType = totalValue > 100 ? 'DPD Next Day' : 'DPD Standard';
    const liability = totalValue > 50 ? '£100' : '£50';
    
    return [
      order.salesRecordNumber,
      order.postToName,
      '',
      order.postToAddress1,
      order.postToAddress2,
      order.postToCity,
      order.postToPostcode,
      order.postToCountry === 'United Kingdom' ? 'GB' : order.postToCountry,
      order.postToPhone,
      order.buyerEmail,
      serviceType, // Column X
      liability, // Column Y
      order.numberOfBoxes.toString(), // Column Z
      '1', // Default weight
      order.buyerNote || '',
    ];
  });

  return Papa.unparse({
    fields: headers,
    data: rows,
  });
}

export function generateFedExCSV(orders: Order[]): string {
  const headers = [
    'Reference',
    'Name',
    'Company',
    'Address1',
    'Address2',
    'City',
    'State',
    'Postcode',
    'Country',
    'Phone',
    'Email',
    'Service Type',
    'Package Type',
    'Weight',
    'Number of Boxes', // Column Z
    'Special Instructions',
    'Signature Required',
  ];

  const rows = orders.map((order) => [
    order.salesRecordNumber,
    order.postToName,
    '',
    order.postToAddress1,
    order.postToAddress2,
    order.postToCity,
    order.postToCounty,
    order.postToPostcode,
    order.postToCountry === 'United Kingdom' ? 'GB' : order.postToCountry,
    order.postToPhone,
    order.buyerEmail,
    'FedEx Express', // Default service
    'Package',
    '1', // Default weight
    order.numberOfBoxes.toString(), // Column Z
    order.buyerNote || '',
    'Yes', // Default signature required
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
