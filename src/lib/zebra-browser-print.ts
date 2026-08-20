'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

// Zebra Browser Print integration.
//
// Browser Print is a tiny local service from Zebra that lets a web page send RAW
// ZPL straight to a USB/network Zebra printer — the printer firmware renders it,
// so the barcodes are perfect and it's FedEx-certification compliant (no image
// conversion). It serves HTTPS on localhost:9101 with a self-signed certificate
// the user trusts once, and only answers pages on its approved-hosts list.
// Download: https://www.zebra.com/us/en/software/printer-software/browser-print.html
//
// We talk to its HTTP API directly (no SDK): GET /available, GET /default, POST
// /write { device, data }. Our app is HTTPS (Netlify), so we must use the HTTPS
// endpoint (mixed-content blocks http://localhost).

const BASES = ['https://localhost:9101', 'https://127.0.0.1:9101'];

async function bpFetch(path: string, init?: RequestInit): Promise<Response | null> {
  for (const base of BASES) {
    try { return await fetch(`${base}${path}`, init); } catch { /* try next */ }
  }
  return null;
}

/** Is Browser Print installed, running and reachable (cert trusted)? */
export async function browserPrintReachable(): Promise<boolean> {
  const r = await bpFetch('/available');
  return !!r && r.ok;
}

async function defaultDevice(): Promise<any | null> {
  let r = await bpFetch('/default?type=printer');
  if (r && r.ok) {
    const d = await r.json().catch(() => null);
    if (d && (d.uid || d.name)) return d;
  }
  r = await bpFetch('/available');
  if (r && r.ok) {
    const d = await r.json().catch(() => null);
    const list = (d?.printer ?? d?.device ?? []) as any[];
    if (Array.isArray(list) && list.length) return list[0];
  }
  return null;
}

export type BpResult = { ok: true } | { ok: false; reachable: boolean; message: string };

/** Send a raw ZPL string to the default Zebra via Browser Print. */
export async function printZplViaBrowserPrint(zpl: string): Promise<BpResult> {
  const reachable = await browserPrintReachable();
  console.log('[BrowserPrint] reachable:', reachable);
  if (!reachable) {
    return { ok: false, reachable: false, message: 'Zebra Browser Print not reachable.' };
  }
  const device = await defaultDevice();
  console.log('[BrowserPrint] device:', device);
  if (!device) {
    return { ok: false, reachable: true, message: 'Browser Print is running but no Zebra printer is selected — open Browser Print and choose the printer.' };
  }
  // /write with an application/json body triggers a CORS preflight that Browser
  // Print only answers for approved hosts. Use text/plain to keep it a "simple"
  // request (no preflight), which is how Zebra's own SDK sends it.
  let res: Response | null = null;
  try {
    res = await bpFetch('/write', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ device, data: zpl }),
    });
  } catch (e: any) {
    console.error('[BrowserPrint] /write threw:', e);
    return { ok: false, reachable: true, message: `Browser Print write error: ${e?.message || e}. Add this site to Browser Print's approved hosts.` };
  }
  console.log('[BrowserPrint] /write status:', res?.status);
  if (!res || !res.ok) {
    return { ok: false, reachable: true, message: `Browser Print couldn't print (${res ? res.status : 'no response / CORS'}). Add this site to Browser Print's approved hosts.` };
  }
  return { ok: true };
}
