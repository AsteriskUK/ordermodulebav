import { trackFedExShipment, FedExTrackingResponse } from './fedex-client';
import { trackDPDShipment, DPDTrackingResponse } from './dpd-client';
import { useOrderStore } from './store';
import { Order, DeliveryCarrier } from './types';

/**
 * Tracking service to check delivery status and update orders
 * This can be called from a scheduled job or API endpoint
 */

export interface TrackingUpdateResult {
  orderId: string;
  trackingNumber: string;
  carrier: DeliveryCarrier;
  status: 'delivered' | 'in_transit' | 'error';
  message?: string;
  error?: string;
}

/**
 * Check a single order's tracking status
 */
export async function checkOrderTracking(order: Order): Promise<TrackingUpdateResult> {
  if (!order.trackingNumber || !order.deliveryCarrier) {
    return {
      orderId: order.id,
      trackingNumber: order.trackingNumber || 'none',
      carrier: order.deliveryCarrier,
      status: 'error',
      error: 'No tracking number or carrier specified',
    };
  }

  try {
    let trackingData: FedExTrackingResponse | DPDTrackingResponse;
    let isDelivered = false;
    let latestStatus = '';

    switch (order.deliveryCarrier) {
      case 'FedEx':
        trackingData = await trackFedExShipment(order.trackingNumber);
        // Check if delivered in FedEx response
        const fedexResult = trackingData.output?.trackingResults?.[0];
        if (fedexResult?.scanEvents) {
          const deliveredEvent = fedexResult.scanEvents.find(
            event => event.scanType.toLowerCase().includes('delivered')
          );
          isDelivered = !!deliveredEvent;
          latestStatus = fedexResult.scanEvents[0]?.scanType || '';
        }
        break;

      case 'DPD':
        trackingData = await trackDPDShipment(order.trackingNumber);
        // Check if delivered in DPD response
        const dpdResult = trackingData.data.trackingInfo?.trackingResult;
        if (dpdResult?.parcelInfo) {
          for (const parcel of dpdResult.parcelInfo) {
            if (parcel.events) {
              const deliveredEvent = parcel.events.find(
                event => event.description.toLowerCase().includes('delivered')
              );
              if (deliveredEvent) {
                isDelivered = true;
                latestStatus = deliveredEvent.description;
                break;
              }
              latestStatus = parcel.events[0]?.description || '';
            }
          }
        }
        break;

      default:
        return {
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          carrier: order.deliveryCarrier,
          status: 'error',
          error: `Unsupported carrier: ${order.deliveryCarrier}`,
        };
    }

    if (isDelivered) {
      // Update order status to delivered
      const store = useOrderStore.getState();
      store.updateOrderStatus(order.id, 'delivered');
      
      return {
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        carrier: order.deliveryCarrier,
        status: 'delivered',
        message: 'Order marked as delivered',
      };
    } else {
      return {
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        carrier: order.deliveryCarrier,
        status: 'in_transit',
        message: latestStatus || 'In transit',
      };
    }
  } catch (error) {
    console.error(`[Tracking] Error checking ${order.deliveryCarrier} tracking ${order.trackingNumber}:`, error);
    return {
      orderId: order.id,
      trackingNumber: order.trackingNumber,
      carrier: order.deliveryCarrier,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check tracking for all shipped orders
 */
export async function checkAllShippedOrders(): Promise<TrackingUpdateResult[]> {
  const store = useOrderStore.getState();
  const shippedOrders = store.orders.filter(
    order => order.status === 'shipped' && 
              order.trackingNumber && 
              order.deliveryCarrier &&
              !order.deletedAt
  );

  console.log(`[Tracking] Checking ${shippedOrders.length} shipped orders`);

  // Check orders in batches to avoid rate limiting
  const batchSize = 5;
  const results: TrackingUpdateResult[] = [];

  for (let i = 0; i < shippedOrders.length; i += batchSize) {
    const batch = shippedOrders.slice(i, i + batchSize);
    const batchPromises = batch.map(order => checkOrderTracking(order));
    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
        if (result.value.status === 'delivered') {
          console.log(`[Tracking] ✓ Order ${result.value.orderId} delivered`);
        }
      } else {
        console.error(`[Tracking] Batch error:`, result.reason);
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < shippedOrders.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const deliveredCount = results.filter(r => r.status === 'delivered').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  
  console.log(`[Tracking] Complete: ${deliveredCount} delivered, ${errorCount} errors, ${results.length - deliveredCount - errorCount} still in transit`);

  return results;
}

/**
 * Check tracking for a specific order by ID
 */
export async function checkOrderById(orderId: string): Promise<TrackingUpdateResult | null> {
  const store = useOrderStore.getState();
  const order = store.orders.find(o => o.id === orderId);
  
  if (!order) {
    return null;
  }

  return checkOrderTracking(order);
}
