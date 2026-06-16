'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { Order, DeliveryCarrier, DeliveryType } from '@/lib/types';
import { deriveCategory } from '@/lib/categoriser';
import { deriveShipping } from '@/lib/csv-parser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { PlusCircle, ArrowLeft, User, Package, MapPin, Truck, Sparkles, Loader2, Search } from 'lucide-react';
import { CATEGORIES } from '@/lib/categoriser';

function generateId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const EMPTY_FORM = {
  salesRecordNumber: '',
  orderNumber: '',
  buyerUsername: '',
  buyerName: '',
  buyerEmail: '',
  buyerNote: '',
  postToName: '',
  postToPhone: '',
  postToAddress1: '',
  postToAddress2: '',
  postToCity: '',
  postToCounty: '',
  postToPostcode: '',
  postToCountry: 'United Kingdom',
  itemTitle: '',
  customLabel: '',
  variation: '',
  quantity: '1',
  soldFor: '',
  postageAndPackaging: '0',
  totalPrice: '',
  deliveryService: '',
  deliveryCarrier: 'DPD' as DeliveryCarrier,
  deliveryType: 'standard' as DeliveryType,
  category: 'N/A',
  comments: '',
  numberOfBoxes: '1',
  postByDate: '',
  saleDate: new Date().toISOString().slice(0, 10),
};

type FormState = typeof EMPTY_FORM;

interface AddressSuggestion {
  address1: string;
  address2: string;
  city: string;
  county: string;
  postcode: string;
  country: string;
}

function Autocomplete<T>({
  value,
  onChange,
  suggestions,
  getLabel,
  onSelect,
  placeholder,
  className,
  inputClassName,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: T[];
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={inputClassName ?? 'h-8 text-sm'}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto text-sm">
          {suggestions.map((item, i) => (
            <li
              key={i}
              className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-slate-700 truncate"
              onMouseDown={(e) => { e.preventDefault(); onSelect(item); setOpen(false); }}
            >
              {getLabel(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children, full }: { label: string; required?: boolean; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="text-xs font-medium text-slate-600 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export function CreateOrderForm() {
  const router = useRouter();
  const addOrders = useOrderStore((s) => s.addOrders);
  const batches = useOrderStore((s) => s.batches);
  const orders = useOrderStore((s) => s.orders);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [aiPrefilling, setAiPrefilling] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressSearching, setAddressSearching] = useState(false);
  const [postcodeStatus, setPostcodeStatus] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle');
  const [citySuggestions, setCitySuggestions] = useState<{ postcode: string; city: string; county: string }[]>([]);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Historical data derived from existing orders ──────────────────
  const knownBuyers = useRef<Map<string, Order>>(new Map());
  const knownItems = useRef<string[]>([]);

  useEffect(() => {
    const buyerMap = new Map<string, Order>();
    const itemSet = new Set<string>();
    for (const o of orders) {
      if (o.buyerUsername) buyerMap.set(o.buyerUsername.toLowerCase(), o);
      if (o.itemTitle) itemSet.add(o.itemTitle);
    }
    knownBuyers.current = buyerMap;
    knownItems.current = Array.from(itemSet);
  }, [orders]);

  const buyerSuggestions = form.buyerUsername.length >= 2
    ? Array.from(knownBuyers.current.entries())
        .filter(([k]) => k.includes(form.buyerUsername.toLowerCase()))
        .slice(0, 8)
        .map(([, o]) => o)
    : [];

  const itemSuggestions = form.itemTitle.length >= 3
    ? knownItems.current
        .filter((t) => t.toLowerCase().includes(form.itemTitle.toLowerCase()))
        .slice(0, 8)
    : [];

  // ── postcodes.io lookup — postcode → city/county/country ────────
  const lookupPostcode = useCallback(async (pc: string) => {
    const clean = pc.replace(/\s/g, '').toUpperCase();
    if (clean.length < 5) { setPostcodeStatus('idle'); return; }
    setPostcodeStatus('loading');
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
      if (!res.ok) { setPostcodeStatus('notfound'); return; }
      const data = await res.json();
      const r = data.result;
      if (!r) { setPostcodeStatus('notfound'); return; }
      setForm((prev) => ({
        ...prev,
        postToCity: prev.postToCity || r.admin_district || r.parish || '',
        postToCounty: prev.postToCounty || r.admin_county || r.admin_district || '',
        postToCountry: 'United Kingdom',
      }));
      setPostcodeStatus('found');
    } catch {
      setPostcodeStatus('notfound');
    }
  }, []);

  // ── postcodes.io reverse — city/town → suggest postcodes ─────────
  const lookupCity = useCallback(async (city: string) => {
    if (city.length < 3) { setCitySuggestions([]); return; }
    try {
      const res = await fetch(`https://api.postcodes.io/places?q=${encodeURIComponent(city)}&limit=6`);
      if (!res.ok) { setCitySuggestions([]); return; }
      const data = await res.json();
      const results = (data.result ?? []).map((p: { postcode?: string; outcode?: string; admin_district?: string; admin_county?: string; name_1?: string }) => ({
        postcode: p.postcode ?? p.outcode ?? '',
        city: p.name_1 ?? p.admin_district ?? '',
        county: p.admin_county ?? p.admin_district ?? '',
      })).filter((p: { postcode: string }) => p.postcode);
      setCitySuggestions(results);
    } catch {
      setCitySuggestions([]);
    }
  }, []);

  // ── Field setter ─────────────────────────────────────────────────
  const set = useCallback((key: keyof FormState, value: string) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'itemTitle') {
        next.category = deriveCategory(value);
      }
      if (key === 'postToPostcode') {
        const price = parseFloat(next.totalPrice) || parseFloat(next.soldFor) || 0;
        const pp = parseFloat(next.postageAndPackaging) || 0;
        const derived = deriveShipping(value, price, pp);
        next.deliveryCarrier = derived.deliveryCarrier;
        next.deliveryType = derived.deliveryType;
        // Debounced postcodes.io lookup
        if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
        addressDebounceRef.current = setTimeout(() => lookupPostcode(value), 400);
      }
      if (key === 'postToCity') {
        // Debounced city → postcode suggestions
        if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current);
        cityDebounceRef.current = setTimeout(() => lookupCity(value), 400);
      }
      if (key === 'soldFor' || key === 'postageAndPackaging') {
        const sold = key === 'soldFor' ? parseFloat(value) || 0 : parseFloat(next.soldFor) || 0;
        const pp = key === 'postageAndPackaging' ? parseFloat(value) || 0 : parseFloat(next.postageAndPackaging) || 0;
        next.totalPrice = (sold + pp).toFixed(2);
      }
      return next;
    }), [lookupPostcode, lookupCity]);

  // ── FedEx street-level address search (manual) ──────────────────
  const searchFedExAddress = useCallback(async (postcode: string, address1: string) => {
    setAddressSearching(true);
    try {
      const res = await fetch('/api/fedex/address-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode, address1 }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAddressSuggestions(data.suggestions ?? []);
      if (!data.suggestions?.length) toast.info('No street-level results from FedEx — fill address manually');
    } catch (e) {
      toast.error(`Address search: ${e instanceof Error ? e.message : 'failed'}`);
      setAddressSuggestions([]);
    } finally {
      setAddressSearching(false);
    }
  }, []);

  const handleManualAddressSearch = () => {
    const pc = form.postToPostcode.trim();
    if (!pc) { toast.error('Enter a postcode first'); return; }
    searchFedExAddress(pc, form.postToAddress1);
  };

  const applyAddress = (s: AddressSuggestion) => {
    setForm((prev) => ({
      ...prev,
      postToAddress1: s.address1 || prev.postToAddress1,
      postToAddress2: s.address2 || prev.postToAddress2,
      postToCity: s.city || prev.postToCity,
      postToCounty: s.county || prev.postToCounty,
      postToPostcode: s.postcode || prev.postToPostcode,
      postToCountry: s.country || prev.postToCountry,
    }));
    setAddressSuggestions([]);
  };

  const applyCitySuggestion = (s: { postcode: string; city: string; county: string }) => {
    setForm((prev) => ({
      ...prev,
      postToCity: s.city || prev.postToCity,
      postToCounty: s.county || prev.postToCounty,
      postToPostcode: prev.postToPostcode || s.postcode,
      postToCountry: 'United Kingdom',
    }));
    setCitySuggestions([]);
  };

  // ── Buyer history fill ───────────────────────────────────────────
  const handleBuyerSelect = (o: Order) => {
    setForm((prev) => ({
      ...prev,
      buyerUsername: o.buyerUsername,
      buyerName: o.buyerName || prev.buyerName,
      buyerEmail: o.buyerEmail || prev.buyerEmail,
      postToName: o.postToName || prev.postToName,
      postToPhone: o.postToPhone || prev.postToPhone,
      postToAddress1: o.postToAddress1 || prev.postToAddress1,
      postToAddress2: o.postToAddress2 || prev.postToAddress2,
      postToCity: o.postToCity || prev.postToCity,
      postToCounty: o.postToCounty || prev.postToCounty,
      postToPostcode: o.postToPostcode || prev.postToPostcode,
      postToCountry: o.postToCountry || prev.postToCountry,
    }));
    toast.success(`Address pre-filled from ${o.buyerUsername}'s last order`);
  };

  // ── AI prefill ───────────────────────────────────────────────────
  const handleAiPrefill = async () => {
    if (!aiDescription.trim()) { toast.error('Describe the order first'); return; }
    setAiPrefilling(true);
    try {
      const res = await fetch('/api/ai/prefill-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription }),
      });
      if (!res.ok) throw new Error('AI request failed');
      const { fields } = await res.json() as { fields: Partial<FormState> };
      setForm((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(fields)) {
          if (v !== undefined && v !== null && v !== '') {
            (next as Record<string, unknown>)[k] = String(v);
          }
        }
        return next;
      });
      toast.success('AI filled the form — review and adjust as needed');
    } catch {
      toast.error('AI prefill failed');
    } finally {
      setAiPrefilling(false);
    }
  };

  const validate = (): string | null => {
    if (!form.itemTitle.trim()) return 'Item title is required';
    if (!form.postToName.trim()) return 'Recipient name is required';
    if (!form.postToAddress1.trim()) return 'Address line 1 is required';
    if (!form.postToCity.trim()) return 'City is required';
    if (!form.postToPostcode.trim()) return 'Postcode is required';
    if (!form.soldFor && !form.totalPrice) return 'Price is required';
    return null;
  };

  const handleSave = (andNew = false) => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);

    const batchId = `manual-batch-${new Date().toISOString().slice(0, 10)}`;
    const existingBatch = batches.find((b) => b.id === batchId);

    const order: Order = {
      id: generateId(),
      salesRecordNumber: form.salesRecordNumber || `M-${Date.now()}`,
      orderNumber: form.orderNumber,
      buyerUsername: form.buyerUsername,
      buyerName: form.buyerName || form.postToName,
      buyerEmail: form.buyerEmail,
      buyerNote: form.buyerNote,
      postToName: form.postToName,
      postToPhone: form.postToPhone,
      postToAddress1: form.postToAddress1,
      postToAddress2: form.postToAddress2,
      postToCity: form.postToCity,
      postToCounty: form.postToCounty,
      postToPostcode: form.postToPostcode.toUpperCase(),
      postToCountry: form.postToCountry,
      itemNumber: '',
      itemTitle: form.itemTitle,
      customLabel: form.customLabel,
      variation: form.variation,
      quantity: parseInt(form.quantity) || 1,
      soldFor: parseFloat(form.soldFor) || 0,
      postageAndPackaging: parseFloat(form.postageAndPackaging) || 0,
      totalPrice: parseFloat(form.totalPrice) || parseFloat(form.soldFor) || 0,
      priority: 5,
      numberOfBoxes: parseInt(form.numberOfBoxes) || 1,
      saleDate: form.saleDate,
      paidOnDate: form.saleDate,
      postByDate: form.postByDate || '',
      dispatchedOnDate: '',
      deliveryService: form.deliveryService,
      trackingNumber: '',
      deliveryCarrier: form.deliveryCarrier,
      deliveryType: form.deliveryType,
      status: 'pending',
      category: form.category,
      comments: form.comments,
      notes: [],
      labelQty: parseInt(form.numberOfBoxes) || 1,
      isGSP: form.postToCountry !== 'United Kingdom' && form.postToCountry !== 'UK' && form.postToCountry !== '',
      extendedLiability: false,
      importedAt: new Date().toISOString(),
      batchId,
    };

    const batch = existingBatch ?? {
      id: batchId,
      name: `Manual Orders ${new Date().toISOString().slice(0, 10)}`,
      importedAt: new Date().toISOString(),
      orderCount: 0,
      source: 'ebay' as const,
    };

    addOrders([order], batch);
    toast.success(`Order #${order.salesRecordNumber} created`);
    setSaving(false);

    if (andNew) {
      setForm({ ...EMPTY_FORM, saleDate: new Date().toISOString().slice(0, 10) });
    } else {
      router.push('/orders');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Create Order</h2>
          <p className="text-sm text-slate-500 mt-0.5">Manually add an order that wasn&apos;t imported from eBay or BackMarket</p>
        </div>
      </div>

      {/* ── AI Prefill ─────────────────────────────────────────── */}
      <Card className="border-purple-200 bg-purple-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-purple-800 flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Order Fill
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-purple-600">Describe the order in plain English and AI will fill the form for you.</p>
          <div className="flex gap-2">
            <textarea
              placeholder="e.g. Dell laptop i5 8GB 256GB sold for £180 + £10 P&P, buyer is john_doe, shipping to 45 Oak Street, Manchester M1 2AB, DPD next day"
              value={aiDescription}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAiDescription(e.target.value)}
              className="flex-1 text-sm min-h-[64px] border border-purple-300 rounded-md px-3 py-2 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <Button
              onClick={handleAiPrefill}
              disabled={aiPrefilling || !aiDescription.trim()}
              className="bg-purple-600 hover:bg-purple-700 shrink-0 self-start"
            >
              {aiPrefilling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {aiPrefilling ? 'Filling...' : 'Fill Form'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Order reference */}
      <Section title="Order Reference" icon={Package}>
        <Field label="Sales Record / Order #">
          <Input
            placeholder="Auto-generated if blank"
            value={form.salesRecordNumber}
            onChange={(e) => set('salesRecordNumber', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="External Order Number">
          <Input
            placeholder="eBay, PayPal, etc."
            value={form.orderNumber}
            onChange={(e) => set('orderNumber', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Sale Date">
          <Input
            type="date"
            value={form.saleDate}
            onChange={(e) => set('saleDate', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Post By Date">
          <Input
            type="date"
            value={form.postByDate}
            onChange={(e) => set('postByDate', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
      </Section>

      {/* Buyer */}
      <Section title="Buyer" icon={User}>
        <Field label="Buyer Username">
          <Autocomplete<Order>
            value={form.buyerUsername}
            onChange={(v) => set('buyerUsername', v)}
            suggestions={buyerSuggestions}
            getLabel={(o) => `${o.buyerUsername} — ${o.postToName} (${o.postToPostcode})`}
            onSelect={handleBuyerSelect}
            placeholder="e.g. john_smith_99"
          />
        </Field>
        <Field label="Buyer Email">
          <Input
            type="email"
            placeholder="buyer@example.com"
            value={form.buyerEmail}
            onChange={(e) => set('buyerEmail', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Buyer Note" full>
          <textarea
            placeholder="Any note from the buyer"
            value={form.buyerNote}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('buyerNote', e.target.value)}
            className="w-full text-sm min-h-[60px] border border-input rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </Field>
      </Section>

      {/* Shipping address */}
      <Section title="Shipping Address" icon={MapPin}>
        <Field label="Recipient Name" required>
          <Input
            placeholder="Full name"
            value={form.postToName}
            onChange={(e) => set('postToName', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Phone">
          <Input
            placeholder="+44 7700 000000"
            value={form.postToPhone}
            onChange={(e) => set('postToPhone', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Postcode" required>
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Input
                placeholder="SW1A 1AA"
                value={form.postToPostcode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('postToPostcode', e.target.value.toUpperCase())}
                className={`h-8 text-sm font-mono pr-7 ${
                  postcodeStatus === 'found' ? 'border-green-400 bg-green-50' :
                  postcodeStatus === 'notfound' ? 'border-red-300' : ''
                }`}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">
                {postcodeStatus === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                {postcodeStatus === 'found' && <span className="text-green-600">&#10003;</span>}
                {postcodeStatus === 'notfound' && <span className="text-red-400">&#10007;</span>}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleManualAddressSearch}
              disabled={addressSearching}
              className="h-8 px-2 shrink-0"
              title="Street-level search via FedEx"
            >
              {addressSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {postcodeStatus === 'found' && form.postToCity && (
            <p className="text-xs text-green-700 mt-0.5">&#10003; {form.postToCity}{form.postToCounty ? `, ${form.postToCounty}` : ''}</p>
          )}
          {postcodeStatus === 'notfound' && (
            <p className="text-xs text-red-500 mt-0.5">Postcode not found — check and try again</p>
          )}
          {addressSuggestions.length > 0 && (
            <ul className="mt-1 border border-blue-200 rounded-md bg-blue-50 text-xs divide-y divide-blue-100 max-h-40 overflow-y-auto">
              {addressSuggestions.map((s, i) => (
                <li
                  key={i}
                  className="px-3 py-1.5 hover:bg-blue-100 cursor-pointer text-blue-800"
                  onClick={() => applyAddress(s)}
                >
                  {[s.address1, s.city, s.postcode].filter(Boolean).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Address Line 1" required>
          <Input
            placeholder="123 High Street"
            value={form.postToAddress1}
            onChange={(e) => set('postToAddress1', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Address Line 2">
          <Input
            placeholder="Flat, suite, etc."
            value={form.postToAddress2}
            onChange={(e) => set('postToAddress2', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="City" required>
          <div className="relative">
            <Input
              placeholder="London"
              value={form.postToCity}
              onChange={(e) => set('postToCity', e.target.value)}
              onFocus={() => { if (form.postToCity.length >= 3) lookupCity(form.postToCity); }}
              className="h-8 text-sm"
            />
            {citySuggestions.length > 0 && (
              <ul className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-40 overflow-y-auto text-xs">
                {citySuggestions.map((s, i) => (
                  <li
                    key={i}
                    className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-slate-700"
                    onMouseDown={(e) => { e.preventDefault(); applyCitySuggestion(s); }}
                  >
                    <span className="font-medium">{s.city}</span>
                    {s.county && s.county !== s.city && <span className="text-slate-400">, {s.county}</span>}
                    <span className="ml-2 font-mono text-slate-400">{s.postcode}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Field>
        <Field label="County">
          <Input
            placeholder="Greater London"
            value={form.postToCounty}
            onChange={(e) => set('postToCounty', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Country">
          <Input
            placeholder="United Kingdom"
            value={form.postToCountry}
            onChange={(e) => set('postToCountry', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
      </Section>

      {/* Item */}
      <Section title="Item Details" icon={Package}>
        <Field label="Item Title" required full>
          <Autocomplete<string>
            value={form.itemTitle}
            onChange={(v) => set('itemTitle', v)}
            suggestions={itemSuggestions}
            getLabel={(t) => t}
            onSelect={(t) => set('itemTitle', t)}
            placeholder="e.g. Dell OptiPlex 7050 SFF i7 16GB 256GB SSD"
          />
        </Field>
        <Field label="Category">
          <div className="flex items-center gap-2">
            <Select value={form.category} onValueChange={(v) => set('category', v ?? 'N/A')}>
              <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.category !== 'N/A' && (
              <Badge variant="outline" className="text-xs shrink-0">Auto</Badge>
            )}
          </div>
        </Field>
        <Field label="SKU / Custom Label">
          <Input
            placeholder="e.g. DELL-7050-001"
            value={form.customLabel}
            onChange={(e) => set('customLabel', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Variation">
          <Input
            placeholder="e.g. 16GB / 256GB"
            value={form.variation}
            onChange={(e) => set('variation', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Quantity">
          <Input
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Sold For (£)" required>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={form.soldFor}
            onChange={(e) => set('soldFor', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Postage & Packaging (£)">
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="0.00"
            value={form.postageAndPackaging}
            onChange={(e) => set('postageAndPackaging', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Total Price (£)">
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="Auto-calculated"
            value={form.totalPrice}
            onChange={(e) => set('totalPrice', e.target.value)}
            className="h-8 text-sm bg-slate-50"
          />
        </Field>
      </Section>

      {/* Shipping */}
      <Section title="Shipping" icon={Truck}>
        <Field label="Carrier">
          <Select value={form.deliveryCarrier} onValueChange={(v) => set('deliveryCarrier', v ?? 'DPD')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(['DPD', 'FedEx', 'Parcelforce', 'Royal Mail', 'Other'] as DeliveryCarrier[]).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Service">
          <Select value={form.deliveryType} onValueChange={(v) => set('deliveryType', v ?? 'standard')}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="next_day">Next Day</SelectItem>
              <SelectItem value="express">Express</SelectItem>
              <SelectItem value="collection">Collection</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Delivery Service Name">
          <Input
            placeholder="e.g. DPD Next Day"
            value={form.deliveryService}
            onChange={(e) => set('deliveryService', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Number of Boxes">
          <Input
            type="number"
            min={1}
            value={form.numberOfBoxes}
            onChange={(e) => set('numberOfBoxes', e.target.value)}
            className="h-8 text-sm"
          />
        </Field>
        <Field label="Notes / Comments" full>
          <textarea
            placeholder="Internal notes for warehouse staff"
            value={form.comments}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('comments', e.target.value)}
            className="w-full text-sm min-h-[60px] border border-input rounded-md px-3 py-2 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          />
        </Field>
      </Section>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={() => handleSave(false)} disabled={saving}>
          <PlusCircle className="h-4 w-4 mr-1.5" />
          Save Order
        </Button>
        <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
          Save &amp; Add Another
        </Button>
        <Button variant="ghost" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
