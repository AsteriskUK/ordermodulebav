import { Order } from './types';
import { deriveShipping } from './csv-parser';
import { deriveCategory } from './categoriser';
import { stableUuid } from './utils';

interface EbayAddress {
  fullName?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
}

interface EbayLineItem {
  lineItemId: string;
  title: string;
  sku?: string;
  quantity: number;
  lineItemCost?: { value: string };
  deliveryCost?: { shippingCost?: { value: string } };
  // eBay Fulfillment API puts the selected variation (CPU/RAM/SSD etc.) here.
  variationAspects?: { name: string; value: string }[];
  properties?: { name: string; value: string }[];
}

interface EbayOrder {
  orderId: string;
  legacyOrderId?: string;
  creationDate: string;
  lastModifiedDate?: string;
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shippingCarrierCode?: string;
      shippingServiceCode?: string;
      shipTo?: {
        fullName?: string;
        phoneNumber?: string;
        email?: string;
        contactAddress?: EbayAddress;
      };
    };
    minEstimatedDeliveryDate?: string;
    maxEstimatedDeliveryDate?: string;
    shipByDate?: string;
  }[];
  buyer?: {
    username?: string;
    buyerRegistrationAddress?: { fullName?: string; email?: string };
  };
  pricingSummary?: {
    priceSubtotal?: { value: string };
    deliveryCost?: { value: string };
    total?: { value: string };
  };
  lineItems?: EbayLineItem[];
  orderFulfillmentStatus?: string;
  paymentStatus?: string;
  salesRecordReference?: string;
}

export function mapEbayOrderToOrder(ebayOrder: EbayOrder, batchId: string): Order[] {
  const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  const addr = shipTo?.contactAddress;
  const pricing = ebayOrder.pricingSummary;
  const buyer = ebayOrder.buyer;

  const postToName = shipTo?.fullName || addr?.fullName || '';
  const postToPhone = shipTo?.phoneNumber || addr?.phoneNumber || '';
  const postToAddress1 = addr?.addressLine1 || '';
  const postToAddress2 = addr?.addressLine2 || '';
  const postToCity = addr?.city || '';
  const postToCounty = addr?.stateOrProvince || '';
  const postToPostcode = addr?.postalCode || '';
  const postToCountry = addr?.countryCode === 'GB' ? 'United Kingdom' : (addr?.countryCode || '');
  const buyerEmail = shipTo?.email || buyer?.buyerRegistrationAddress?.email || '';
  const buyerUsername = buyer?.username || '';
  const buyerName = buyer?.buyerRegistrationAddress?.fullName || postToName;

  const totalPrice = parseFloat(pricing?.total?.value || '0');
  const postageAndPackaging = parseFloat(pricing?.deliveryCost?.value || '0');
  const saleDate = ebayOrder.creationDate;
  const shipByDate = ebayOrder.fulfillmentStartInstructions?.[0]?.shipByDate || '';

  const { deliveryCarrier, deliveryType } = deriveShipping(postToPostcode, totalPrice, postageAndPackaging);

  const lineItems = ebayOrder.lineItems || [];

  // One Order per line item — merging into a single shipment row happens at display time in batch shipping
  return lineItems.map((item, idx) => {
    const itemTotal = parseFloat(item.lineItemCost?.value || '0') * item.quantity;
    // Variation lives in variationAspects (the selected CPU/RAM/SSD/etc.); older
    // code read `properties`, which doesn't hold the variation, so variations came
    // through blank. Prefer variationAspects, fall back to properties.
    const aspects = Array.isArray(item.variationAspects) && item.variationAspects.length
      ? item.variationAspects
      : (Array.isArray(item.properties) ? item.properties : []);
    const variation = aspects
      .filter((p) => p.name && p.value !== undefined && p.value !== '' && p.name.toUpperCase() !== 'SKU')
      .map((p) => `${p.name}: ${p.value}`)
      .join(', ') || '';

    const category = deriveCategory(item.title);

    return {
      id: stableUuid(`ebay-${ebayOrder.orderId}-${idx}`),
      salesRecordNumber: ebayOrder.salesRecordReference || ebayOrder.legacyOrderId || ebayOrder.orderId,
      orderNumber: ebayOrder.orderId,
      buyerUsername,
      buyerName,
      buyerEmail,
      buyerNote: '',
      postToName,
      postToPhone,
      postToAddress1,
      postToAddress2,
      postToCity,
      postToCounty,
      postToPostcode,
      postToCountry,
      itemNumber: item.lineItemId,
      itemTitle: item.title,
      customLabel: item.sku || '',
      variation,
      quantity: item.quantity,
      soldFor: itemTotal,
      postageAndPackaging: idx === 0 ? postageAndPackaging : 0,
      totalPrice: idx === 0 ? totalPrice : itemTotal,
      priority: 5,
      numberOfBoxes: 1,
      saleDate,
      paidOnDate: saleDate,
      postByDate: shipByDate,
      dispatchedOnDate: '',
      deliveryService: ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shippingServiceCode || '',
      trackingNumber: '',
      deliveryCarrier,
      deliveryType,
      status: 'pending',
      category,
      comments: '',
      labelQty: 1,
      isGSP: (addr?.countryCode || 'GB') !== 'GB',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    };
  });
}
