'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Printer, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  PrinterConfig, DEFAULT_PRINTER_CONFIG, fetchPrinterConfig, savePrinterConfig, listAgentPrinters,
} from '@/lib/print-agent';

const fieldCls = 'w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function PrinterSettings() {
  const [cfg, setCfg] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [printers, setPrinters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPrinterConfig().then((c) => { setCfg(c); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  function set<K extends keyof PrinterConfig>(key: K, value: PrinterConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  async function loadPrinters() {
    if (!cfg.agentUrl) { toast.error('Enter the agent URL first'); return; }
    setChecking(true);
    try {
      const list = await listAgentPrinters(cfg.agentUrl, cfg.token);
      setPrinters(list);
      setOnline(true);
      toast.success(`Found ${list.length} printer${list.length !== 1 ? 's' : ''}`);
    } catch (e) {
      setOnline(false);
      toast.error(`Could not reach print agent: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await savePrinterConfig(cfg);
      toast.success('Printer settings saved');
    } catch {
      toast.error('Failed to save printer settings');
    } finally {
      setSaving(false);
    }
  }

  // A printer picker — a dropdown of discovered printers, or a free-text input
  // when we haven't loaded the list yet (so it works before the agent is reachable).
  function printerField(label: string, key: 'invoicePrinter' | 'fedexPrinter' | 'dpdPrinter') {
    return (
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">{label}</label>
        {printers.length > 0 ? (
          <select className={fieldCls} value={cfg[key]} onChange={(e) => set(key, e.target.value)}>
            <option value="">— none —</option>
            {printers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <Input value={cfg[key]} onChange={(e) => set(key, e.target.value)} placeholder="Printer name" className="h-9" />
        )}
      </div>
    );
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-700 flex items-center gap-2">
          <Printer className="h-4 w-4" /> Printers (auto invoice &amp; labels)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Point this at the local <span className="font-mono">print-agent</span> running on the warehouse PC.
          Invoices auto-print when new orders arrive; labels route to the FedEx or DPD printer by carrier.
        </p>

        <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Agent URL</label>
            <Input value={cfg.agentUrl} onChange={(e) => { set('agentUrl', e.target.value); setOnline(null); }}
              placeholder="http://localhost:17777" className="h-9" />
          </div>
          <Button variant="outline" onClick={loadPrinters} disabled={checking} className="h-9">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${checking ? 'animate-spin' : ''}`} /> Load printers
          </Button>
        </div>

        {online !== null && (
          <p className={`text-xs flex items-center gap-1 ${online ? 'text-green-600' : 'text-red-600'}`}>
            {online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {online ? 'Print agent reachable' : 'Print agent not reachable'}
          </p>
        )}

        <div>
          <label className="text-xs font-medium text-slate-600 mb-1 block">Shared secret (optional)</label>
          <Input value={cfg.token} onChange={(e) => set('token', e.target.value)} placeholder="Matches PRINT_AGENT_TOKEN, if set" className="h-9" />
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          {printerField('Invoice printer', 'invoicePrinter')}
          {printerField('FedEx label printer', 'fedexPrinter')}
          {printerField('DPD label printer', 'dpdPrinter')}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={cfg.autoInvoice} onChange={(e) => set('autoInvoice', e.target.checked)} className="h-4 w-4 accent-blue-600" />
          Auto-print invoices when new orders are pulled in
        </label>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save printer settings'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
