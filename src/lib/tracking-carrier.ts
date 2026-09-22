import { trackFedExShipment } from './fedex-client';
import { trackDPDShipment } from './dpd-client';

// ============================================================================
// CARRIER TRACKING STATUS (server-only)
// ----------------------------------------------------------------------------
// Calls the FedEx / DPD tracking APIs (which need server-side credentials) and
// reduces the response to the few flags the app acts on. NO store access — the
// status transitions are applied client-side (see tracking-client.ts) so they
// persist through the normal store→DB sync. This runs on the server because the
// old design read the client Zustand store from an API route, where it is
// always empty, so nothing was ever checked.
// ============================================================================

// Scans that exist BEFORE the courier physically has the parcel — a label being
// created isn't a real movement, so these don't count as a courier scan.
const PRE_SCAN_RE = /information sent|shipment information|label (created|generated)|order (created|received|processed)|received your order details|expecting your parcel|awaiting|pre.?advice|not yet/i;

export interface CarrierStatus {
  delivered: boolean;
  hasCourierScan: boolean;
  latestStatus: string;
  error?: string;
}

export async function carrierTrackingStatus(carrier: string, trackingNumber: string): Promise<CarrierStatus> {
  try {
    if (carrier === 'FedEx') {
      const data = await trackFedExShipment(trackingNumber);
      const r = data.output?.trackingResults?.[0];
      let delivered = false, hasCourierScan = false, latestStatus = '';
      if (r?.scanEvents?.length) {
        delivered = r.scanEvents.some((e) => (e.scanType || '').toLowerCase().includes('delivered'));
        hasCourierScan = r.scanEvents.some((e) => !PRE_SCAN_RE.test(e.scanType || ''));
        latestStatus = r.scanEvents[0]?.scanType || '';
      }
      return { delivered, hasCourierScan, latestStatus };
    }

    if (carrier === 'DPD') {
      const data = await trackDPDShipment(trackingNumber);
      const dpd = data.data.trackingInfo?.trackingResult;
      let delivered = false, hasCourierScan = false, latestStatus = '';
      if (dpd?.parcelInfo) {
        for (const parcel of dpd.parcelInfo) {
          if (parcel.events?.length) {
            if (parcel.events.some((e) => !PRE_SCAN_RE.test(e.description || ''))) hasCourierScan = true;
            const d = parcel.events.find((e) => e.description.toLowerCase().includes('delivered'));
            if (d) { delivered = true; latestStatus = d.description; break; }
            latestStatus = parcel.events[0]?.description || '';
          }
        }
      }
      return { delivered, hasCourierScan, latestStatus };
    }

    return { delivered: false, hasCourierScan: false, latestStatus: '', error: `Unsupported carrier: ${carrier}` };
  } catch (e) {
    return { delivered: false, hasCourierScan: false, latestStatus: '', error: e instanceof Error ? e.message : String(e) };
  }
}
