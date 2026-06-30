'use client';

import { useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { X, Printer, CheckCircle, Loader2, Mail, QrCode } from 'lucide-react';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface ReturnResult {
  trackingNumber: string;
  consignmentNumber?: string;
  labelHtml: string;
  barcodes: { parcelNumber: string; imageData: string; imageFormat: string }[];
  emailed: boolean;
}

const fieldCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

export function ReturnLabelDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const addReturn = useOrderStore((s) => s.addReturn);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const [weight, setWeight] = useState(order.numberOfBoxes ?? 1);
  const [sendEmail, setSendEmail] = useState(false);
  const [wantBarcode, setWantBarcode] = useState(false);
  // Customer address — prefilled from the order, editable in case it changed.
  const [name, setName] = useState(order.postToName ?? order.buyerName ?? '');
  const [phone, setPhone] = useState(order.postToPhone ?? '');
  const [email, setEmail] = useState(order.buyerEmail ?? '');
  const [address1, setAddress1] = useState(order.postToAddress1 ?? '');
  const [address2, setAddress2] = useState(order.postToAddress2 ?? '');
  const [city, setCity] = useState(order.postToCity ?? '');
  const [county, setCounty] = useState(order.postToCounty ?? '');
  const [postcode, setPostcode] = useState(order.postToPostcode ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReturnResult | null>(null);

  async function generate() {
    if (!address1 || !postcode || !name) { toast.error('Name, address and postcode are required'); return; }
    if (sendEmail && !email) { toast.error('Add the customer email to send the label'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/dpd/create-return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight, sendEmail, wantBarcode,
          reference: order.salesRecordNumber,
          customer: { name, phone, email, address1, address2, city, county, postcode, country: order.postToCountry },
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message || 'Failed to create return label'); return; }

      const tracking: string = data.trackingNumber;

      // Auto-create an OPEN return linked to the original order.
      addReturn({
        id: generateId(),
        orderId: order.id,
        salesRecordNumber: order.salesRecordNumber,
        orderNumber: order.orderNumber ?? '',
        buyerUsername: order.buyerUsername ?? order.buyerName ?? '',
        itemTitle: order.itemTitle,
        reason: 'Customer return',
        notes: `Return label issued via DPD${data.emailed ? ' (emailed to customer)' : ''}.`,
        returnedAt: new Date().toISOString(),
        createdByUserId: currentUser?.id,
        createdByUserName: currentUser?.name,
        status: 'pending',
        returnTrackingNumber: tracking,
      });

      setResult({
        trackingNumber: tracking,
        consignmentNumber: data.consignmentNumber,
        labelHtml: data.labelHtml ?? '',
        barcodes: data.barcodes ?? [],
        emailed: !!data.emailed,
      });
      toast.success('Return created & open return logged');
    } catch {
      toast.error('Failed to reach DPD');
    } finally {
      setSubmitting(false);
    }
  }

  function printLabel() {
    if (!result?.labelHtml) { toast.error('No printable label returned'); return; }
    const win = window.open('', '_return_label');
    if (!win) { toast.error('Pop-up blocked — allow pop-ups to print'); return; }
    win.document.write(`<html><body style="margin:0">${result.labelHtml}</body></html>`);
    win.document.close();
    win.onload = () => win.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-slate-900">Issue return label</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>

        {result ? (
          <div className="p-6 space-y-4 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
            <div>
              <p className="font-semibold text-slate-800">Return created</p>
              <p className="text-sm text-slate-500 mt-1">Tracking <span className="font-mono">{result.trackingNumber}</span></p>
              <p className="text-xs text-slate-400 mt-1">Open return logged against #{order.salesRecordNumber}{result.emailed ? ' · emailed to customer' : ''}.</p>
            </div>

            {result.barcodes.length > 0 && (
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs text-slate-500">2D barcode (show at a DPD Pickup point)</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/${result.barcodes[0].imageFormat};base64,${result.barcodes[0].imageData}`} alt="DPD return barcode" className="h-40 w-40 object-contain border rounded" />
              </div>
            )}

            <div className="flex justify-center gap-2">
              {result.labelHtml && <Button onClick={printLabel}><Printer className="h-4 w-4 mr-1.5" /> Print label</Button>}
              <Button variant="outline" onClick={onClose}>Done</Button>
            </div>
            {!result.labelHtml && result.barcodes.length === 0 && (
              <p className="text-xs text-amber-600">DPD didn’t return a label/barcode image — the return is still logged with its tracking number.</p>
            )}
          </div>
        ) : (
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className="text-xs text-slate-500">
              Creates a DPD return — the customer drops the parcel at a DPD Pickup point using a printed label or a 2D barcode.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Weight (kg)</label>
                <Input type="number" min={0.1} step={0.1} value={weight} onChange={(e) => setWeight(Number(e.target.value) || 1)} />
              </div>
              <button type="button" onClick={() => setSendEmail((v) => !v)} className={`flex flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium py-2 ${sendEmail ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                <Mail className="h-4 w-4" /> Email to customer
              </button>
              <button type="button" onClick={() => setWantBarcode((v) => !v)} className={`flex flex-col items-center justify-center gap-1 rounded-md border text-xs font-medium py-2 ${wantBarcode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                <QrCode className="h-4 w-4" /> 2D barcode
              </button>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-slate-600 mb-2">Customer (return-from) address</p>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
                </div>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (required to email label)" />
                <Input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="Address line 1" />
                <Input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Address line 2" />
                <div className="grid grid-cols-3 gap-2">
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
                  <Input value={county} onChange={(e) => setCounty(e.target.value)} placeholder="County" />
                  <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="Postcode" />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={generate} disabled={submitting}>
                {submitting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Creating…</> : 'Create return'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
