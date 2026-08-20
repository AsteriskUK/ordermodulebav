'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Direct raw printing to a USB-connected printer (e.g. a Zebra / FedEx thermal
// label printer) straight from the browser via WebUSB — no print agent, driver
// or download needed. The exact ZPL bytes are streamed to the printer's bulk
// endpoint, which is what the thermal printer wants (no image conversion).
//
// Support: Chrome/Edge over HTTPS (or localhost). Safari/Firefox lack WebUSB.
// On Windows the system print driver often "claims" the printer, which blocks
// the browser from grabbing the interface — printRawToUsbPrinter surfaces that
// so the UI can tell the user to use the print agent instead of silently
// downloading. The first print shows a one-time picker; the grant is remembered.

const PRINTER_CLASS = 7;       // USB base class 7 = Printer
const VENDOR_CLASS = 0xff;     // vendor-specific (some printers expose raw here)

export type UsbPrintResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'cancelled'; message?: string }
  | { ok: false; reason: 'failed'; message: string };

export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).usb;
}

function deviceIsPrinter(d: any): boolean {
  if (d.deviceClass === PRINTER_CLASS) return true;
  const cfg = d.configuration ?? d.configurations?.[0];
  return !!cfg?.interfaces?.some((i: any) =>
    (i.alternates ?? [i.alternate]).some((a: any) => a?.interfaceClass === PRINTER_CLASS));
}

async function knownPrinter(): Promise<any | null> {
  const usb = (navigator as any).usb;
  if (!usb) return null;
  const devices = await usb.getDevices();
  return devices.find(deviceIsPrinter) ?? devices[0] ?? null;
}

// Rank interfaces we might write to: real printer class first, then vendor
// specific, then anything else — but only ones that expose a bulk OUT endpoint.
function candidateInterfaces(device: any): { num: number; ep: number; cls: number }[] {
  const out: { num: number; ep: number; cls: number }[] = [];
  for (const iface of device.configuration?.interfaces ?? []) {
    const alt = iface.alternate ?? iface.alternates?.[0];
    const ep = alt?.endpoints?.find((e: any) => e.direction === 'out' && e.type === 'bulk');
    if (ep) out.push({ num: iface.interfaceNumber, ep: ep.endpointNumber, cls: alt.interfaceClass });
  }
  const rank = (c: number) => (c === PRINTER_CLASS ? 0 : c === VENDOR_CLASS ? 1 : 2);
  return out.sort((a, b) => rank(a.cls) - rank(b.cls));
}

/** Stream raw bytes to a USB printer. See UsbPrintResult for outcomes. */
export async function printRawToUsbPrinter(bytes: Uint8Array): Promise<UsbPrintResult> {
  const usb = (navigator as any).usb;
  if (!usb) return { ok: false, reason: 'unsupported' };

  let device = await knownPrinter();
  if (!device) {
    try {
      device = await usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] });
    } catch {
      return { ok: false, reason: 'cancelled' };
    }
  }
  if (!device) return { ok: false, reason: 'cancelled' };

  try {
    await device.open();
  } catch (e: any) {
    return { ok: false, reason: 'failed', message: `Couldn't open the printer: ${e?.message || e}` };
  }

  try {
    if (!device.configuration) await device.selectConfiguration(1);
    const candidates = candidateInterfaces(device);
    if (candidates.length === 0) return { ok: false, reason: 'failed', message: 'No writable interface found on this device.' };

    let claimed: { num: number; ep: number } | null = null;
    let lastErr = '';
    for (const c of candidates) {
      try { await device.claimInterface(c.num); claimed = c; break; }
      catch (e: any) { lastErr = e?.message || String(e); }
    }
    if (!claimed) {
      return { ok: false, reason: 'failed',
        message: `Windows won't let the browser take the printer (it's held by the print driver): ${lastErr}. Use the print agent for direct ZPL printing.` };
    }
    await device.transferOut(claimed.ep, bytes);
    try { await device.releaseInterface(claimed.num); } catch { /* ignore */ }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: 'failed', message: `Print transfer failed: ${e?.message || e}` };
  } finally {
    try { await device.close(); } catch { /* ignore */ }
  }
}
