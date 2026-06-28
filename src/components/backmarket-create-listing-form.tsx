'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Back Market condition grades
const BM_CONDITIONS: { value: number; label: string; description: string }[] = [
  { value: 1, label: 'Like New',   description: 'No visible signs of use' },
  { value: 2, label: 'Excellent',  description: 'Barely noticeable signs of use' },
  { value: 3, label: 'Good',       description: 'Minor signs of use' },
  { value: 4, label: 'Fair',       description: 'Noticeable signs of use' },
];

interface FormState {
  sku: string;
  listingId: string;
  price: string;
  quantity: string;
  condition: number;
  description: string;
  currency: string;
  new_battery: boolean;
  min_price: string;
}

const INITIAL: FormState = {
  sku: '',
  listingId: '',
  price: '',
  quantity: '1',
  condition: 2,
  description: '',
  currency: 'GBP',
  new_battery: false,
  min_price: '',
};

export function BackmarketCreateListingForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [resultId, setResultId] = useState<number | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.sku || !form.listingId || !form.price || !form.quantity) {
      toast.error('SKU, Back Market product ID, price, and quantity are required');
      return;
    }

    const listingNum = parseInt(form.listingId, 10);
    if (isNaN(listingNum)) {
      toast.error('Back Market product ID must be a number');
      return;
    }

    const priceNum = parseFloat(form.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      toast.error('Price must be a positive number');
      return;
    }

    const body: Record<string, unknown> = {
      sku: form.sku,
      listing: listingNum,
      price: priceNum,
      quantity: parseInt(form.quantity, 10) || 1,
      condition: form.condition,
      description: form.description,
      currency: form.currency,
      new_battery: form.new_battery,
    };

    if (form.min_price) {
      const minPriceNum = parseFloat(form.min_price);
      if (!isNaN(minPriceNum) && minPriceNum > 0) body.min_price = minPriceNum;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/backmarket/listings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? 'Failed to create listing');
      setResultId(data.result?.id ?? null);
      toast.success('Back Market listing created!');
      setForm(INITIAL);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Listing creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {resultId && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-green-300 bg-green-50 text-green-800 text-sm">
          Listing created — Back Market ID: <strong>{resultId}</strong>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Product Identification ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Product</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Your SKU *</label>
              <Input
                value={form.sku}
                onChange={(e) => setField('sku', e.target.value)}
                placeholder="MY-SKU-001"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                Back Market Product ID *{' '}
                <span className="text-slate-400">(catalog listing ID)</span>
              </label>
              <Input
                type="number"
                value={form.listingId}
                onChange={(e) => setField('listingId', e.target.value)}
                placeholder="12345678"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Condition *</label>
            <div className="grid grid-cols-2 gap-2">
              {BM_CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setField('condition', c.value)}
                  className={`text-left px-3 py-2 rounded-md border text-sm transition-colors ${
                    form.condition === c.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">{c.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              Condition Description <span className="text-slate-400">(visible to buyers)</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="Describe the condition in detail — any cosmetic issues, what's included, battery health, etc."
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="new_battery"
              type="checkbox"
              checked={form.new_battery}
              onChange={(e) => setField('new_battery', e.target.checked)}
              className="rounded border-slate-300"
            />
            <label htmlFor="new_battery" className="text-sm text-slate-700">New battery fitted</label>
          </div>
        </section>

        {/* ── Pricing & Stock ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Pricing &amp; Stock</h2>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Price *</label>
              <Input
                type="number" min="0.01" step="0.01"
                value={form.price}
                onChange={(e) => setField('price', e.target.value)}
                placeholder="199.99"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Min Price <span className="text-slate-400">(optional)</span></label>
              <Input
                type="number" min="0.01" step="0.01"
                value={form.min_price}
                onChange={(e) => setField('min_price', e.target.value)}
                placeholder="149.99"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => setField('currency', e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="GBP">GBP (£)</option>
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Quantity *</label>
            <Input
              type="number" min="1"
              value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)}
              className="w-24"
            />
          </div>
        </section>

        <div className="pt-2 pb-8">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Creating listing…' : 'Create Back Market Listing'}
          </Button>
        </div>
      </form>
    </div>
  );
}
