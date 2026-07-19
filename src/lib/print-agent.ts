import { Order } from './types';
import { buildInvoicesHtml } from './order-utils';

// Client for the self-hosted print agent (see /print-agent). Config is shared
// across all devices via app_settings so every till/tablet prints to the same
// physical printers.

export interface PrinterConfig {
  agentUrl: string;        // e.g. http://localhost:17777 or http://<lan-ip>:17777
  token: string;           // optional shared secret (matches PRINT_AGENT_TOKEN)
  invoicePrinter: string;
  fedexPrinter: string;
  dpdPrinter: string;
  autoInvoice: boolean;    // auto-print invoices when new orders are pulled in
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  agentUrl: '', token: '', invoicePrinter: '', fedexPrinter: '', dpdPrinter: '', autoInvoice: false,
};

const KEY = 'printer_config';

// Printer config lives in app_settings alongside marketplace credentials, which
// the anon key cannot read — so go through /api/config (allow-listed keys).
export async function fetchPrinterConfig(): Promise<PrinterConfig> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return DEFAULT_PRINTER_CONFIG;
    const { printerConfig } = await res.json() as { printerConfig: Partial<PrinterConfig> | null };
    return printerConfig ? { ...DEFAULT_PRINTER_CONFIG, ...printerConfig } : DEFAULT_PRINTER_CONFIG;
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

export async function savePrinterConfig(cfg: PrinterConfig): Promise<void> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, value: cfg }),
  });
  if (!res.ok) throw new Error(await res.text());
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}
const base = (url: string) => url.replace(/\/+$/, '');

export async function listAgentPrinters(agentUrl: string, token = ''): Promise<string[]> {
  const res = await fetch(`${base(agentUrl)}/printers`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Agent responded ${res.status}`);
  const data = await res.json() as { printers?: string[] };
  return data.printers ?? [];
}

interface PrintJob { printer: string; html?: string; pdfBase64?: string; copies?: number; jobName?: string }

async function sendPrintJob(cfg: PrinterConfig, job: PrintJob): Promise<void> {
  const res = await fetch(`${base(cfg.agentUrl)}/print`, { method: 'POST', headers: headers(cfg.token), body: JSON.stringify(job) });
  if (!res.ok) throw new Error(`Print failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Print the combined invoice sheet for these orders to the invoice printer.
 *  Returns false (no-op) when printing isn't configured. */
export async function printInvoicesFor(orders: Order[], cfg?: PrinterConfig): Promise<boolean> {
  const c = cfg ?? await fetchPrinterConfig();
  if (!c.agentUrl || !c.invoicePrinter || orders.length === 0) return false;
  await sendPrintJob(c, { printer: c.invoicePrinter, html: buildInvoicesHtml(orders), jobName: `Invoices-${orders.length}` });
  return true;
}

export function printerForCarrier(cfg: PrinterConfig, carrier: string): string {
  if (/dpd/i.test(carrier)) return cfg.dpdPrinter;
  if (/fedex/i.test(carrier)) return cfg.fedexPrinter;
  return '';
}

/** Route a carrier label to its printer. `label` is a base64 PDF or raw HTML.
 *  Returns false when no printer is mapped for the carrier / agent not set. */
export async function printLabel(carrier: string, label: string, cfg?: PrinterConfig, jobName = 'Label'): Promise<boolean> {
  const c = cfg ?? await fetchPrinterConfig();
  const printer = printerForCarrier(c, carrier);
  if (!c.agentUrl || !printer) return false;
  const isHtml = label.trimStart().startsWith('<');
  await sendPrintJob(c, isHtml ? { printer, html: label, jobName } : { printer, pdfBase64: label, jobName });
  return true;
}
