'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Direct raw printing to a USB-connected printer (e.g. a Zebra / FedEx thermal
// label printer) straight from the browser via WebUSB — no print agent, driver
// or download needed. The exact ZPL bytes are streamed to the printer's bulk
// endpoint, which is what the thermal printer wants.
//
// Support: Chrome/Edge over HTTPS (or localhost). Safari and Firefox do NOT
// implement WebUSB — callers must fall back (print agent, or a preview/download).
// The first print shows a one-time device picker; the grant is then remembered
// (navigator.usb.getDevices), so later prints go straight through.

const PRINTER_CLASS = 7; // USB base class 7 = Printer

export function isWebUsbAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).usb;
}

function deviceIsPrinter(d: any): boolean {
  if (d.deviceClass === PRINTER_CLASS) return true;
  const cfg = d.configuration ?? d.configurations?.[0];
  return !!cfg?.interfaces?.some((i: any) =>
    (i.alternates ?? [i.alternate]).some((a: any) => a?.interfaceClass === PRINTER_CLASS));
}

/** A previously-authorised USB printer, if any (no prompt). */
async function knownPrinter(): Promise<any | null> {
  const usb = (navigator as any).usb;
  if (!usb) return null;
  const devices = await usb.getDevices();
  return devices.find(deviceIsPrinter) ?? devices[0] ?? null;
}

/** Send raw bytes to a USB printer. Returns false if WebUSB is unavailable or the
 *  user cancels the picker; throws only on a real transfer error. */
export async function printRawToUsbPrinter(bytes: Uint8Array): Promise<boolean> {
  const usb = (navigator as any).usb;
  if (!usb) return false;

  let device = await knownPrinter();
  if (!device) {
    try {
      // requestDevice must run inside a user gesture (the print-button click).
      device = await usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] });
    } catch {
      return false; // user dismissed the picker
    }
  }
  if (!device) return false;

  await device.open();
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    // Find the printer interface and its bulk OUT endpoint.
    let ifaceNum = -1, epNum = -1;
    for (const iface of device.configuration.interfaces) {
      const alt = iface.alternate ?? iface.alternates?.[0];
      const isPrinterIface = alt?.interfaceClass === PRINTER_CLASS || device.deviceClass === PRINTER_CLASS;
      if (!isPrinterIface) continue;
      const ep = alt.endpoints.find((e: any) => e.direction === 'out' && e.type === 'bulk');
      if (ep) { ifaceNum = iface.interfaceNumber; epNum = ep.endpointNumber; break; }
    }
    if (ifaceNum < 0) throw new Error('No printer interface found on the selected USB device');
    await device.claimInterface(ifaceNum);
    await device.transferOut(epNum, bytes);
    try { await device.releaseInterface(ifaceNum); } catch { /* ignore */ }
    return true;
  } finally {
    try { await device.close(); } catch { /* ignore */ }
  }
}
