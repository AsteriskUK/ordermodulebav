'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ExternalLink, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  EbayBusinessPolicy,
  EbayInventoryLocation,
  EbayListingCondition,
  EbayListingFormat,
  LISTING_CONDITION_LABELS,
} from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AspectRow { key: string; value: string }

interface VariationRow {
  id: string;
  aspectValues: Record<string, string>;
  price: string;
  quantity: string;
  imageUrl: string;
}

interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  breadcrumb: string;
}

type ListingType = 'single' | 'variation';

interface FormState {
  sku: string;
  title: string;
  description: string;
  condition: EbayListingCondition;
  quantity: string;
  imageUrls: string;
  aspects: AspectRow[];
  categoryId: string;
  categoryName: string;
  format: EbayListingFormat;
  price: string;
  merchantLocationKey: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  fulfillmentPolicyId: string;
  listingType: ListingType;
  varyingAspects: string[];
  variations: VariationRow[];
}

const makeVariation = (): VariationRow => ({
  id: Math.random().toString(36).slice(2),
  aspectValues: {},
  price: '',
  quantity: '1',
  imageUrl: '',
});

const INITIAL_FORM: FormState = {
  sku: '',
  title: '',
  description: '',
  condition: 'NEW',
  quantity: '1',
  imageUrls: '',
  aspects: [{ key: '', value: '' }],
  categoryId: '',
  categoryName: '',
  format: 'FIXED_PRICE',
  price: '',
  merchantLocationKey: '',
  paymentPolicyId: '',
  returnPolicyId: '',
  fulfillmentPolicyId: '',
  listingType: 'single',
  varyingAspects: [''],
  variations: [makeVariation(), makeVariation()],
};

// ─── Category Search ──────────────────────────────────────────────────────────

function CategorySearch({
  categoryId,
  categoryName,
  onSelect,
  onClear,
}: {
  categoryId: string;
  categoryName: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CategorySuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/ebay/listings/categories?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
        setOpen(true);
      } catch {
        // silent — category search is best-effort
      } finally {
        setSearching(false);
      }
    }, 350);
  }

  function handleSelect(s: CategorySuggestion) {
    onSelect(s.categoryId, s.categoryName);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
  }

  if (categoryId) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-slate-50 text-sm">
        <span className="flex-1 truncate text-slate-800">
          <span className="font-medium">{categoryName}</span>
          <span className="text-slate-400 ml-1">(ID: {categoryId})</span>
        </span>
        <button type="button" onClick={onClear} className="shrink-0 text-slate-400 hover:text-slate-700">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search categories, e.g. Laptops, iPhone, Trainers…"
            onFocus={() => suggestions.length > 0 && setOpen(true)}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">searching…</span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => handleQueryChange(query)}>
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s.categoryId}
              type="button"
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b last:border-0"
            >
              <p className="text-sm text-slate-800 truncate">{s.breadcrumb}</p>
              <p className="text-xs text-slate-400">ID: {s.categoryId}</p>
            </button>
          ))}
        </div>
      )}
      {open && !searching && query.length >= 2 && suggestions.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-sm px-3 py-2 text-sm text-slate-500">
          No categories found for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

// ─── Main Form ────────────────────────────────────────────────────────────────

export function CreateListingForm() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [policies, setPolicies] = useState<EbayBusinessPolicy[]>([]);
  const [locations, setLocations] = useState<EbayInventoryLocation[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultListingId, setResultListingId] = useState<string | null>(null);

  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocation, setNewLocation] = useState({ key: '', name: '', postalCode: '', country: 'GB' });
  const [creatingLocation, setCreatingLocation] = useState(false);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [policiesRes, locationsRes] = await Promise.all([
        fetch('/api/ebay/listings/business-policies'),
        fetch('/api/ebay/listings/location'),
      ]);

      if (!policiesRes.ok) {
        const d = await policiesRes.json();
        if (d.error === 'not_connected') {
          setMetaError('eBay account not connected. Connect via the Import Orders page first.');
          return;
        }
        if (d.error === 'scope_missing') {
          setMetaError(
            'Your eBay session is missing the required permissions. Go to Import Orders and click "Connect eBay Account" to re-authorise with the new scopes.'
          );
          return;
        }
        throw new Error(d.message ?? 'Failed to load business policies');
      }

      const policiesData = await policiesRes.json();
      const locationsData = locationsRes.ok ? await locationsRes.json() : { locations: [] };

      setPolicies(policiesData.policies ?? []);
      setLocations(locationsData.locations ?? []);

      const payment = (policiesData.policies ?? []).filter((p: EbayBusinessPolicy) => p.policyType === 'PAYMENT');
      const returns = (policiesData.policies ?? []).filter((p: EbayBusinessPolicy) => p.policyType === 'RETURN_POLICY');
      const fulfillment = (policiesData.policies ?? []).filter((p: EbayBusinessPolicy) => p.policyType === 'FULFILLMENT');
      const locs: EbayInventoryLocation[] = locationsData.locations ?? [];

      setForm((f) => ({
        ...f,
        paymentPolicyId: payment.length === 1 ? payment[0].policyId : f.paymentPolicyId,
        returnPolicyId: returns.length === 1 ? returns[0].policyId : f.returnPolicyId,
        fulfillmentPolicyId: fulfillment.length === 1 ? fulfillment[0].policyId : f.fulfillmentPolicyId,
        merchantLocationKey: locs.length === 1 ? locs[0].merchantLocationKey : f.merchantLocationKey,
      }));
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'Failed to load eBay settings');
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Aspects (common)
  function setAspect(i: number, field: 'key' | 'value', value: string) {
    setForm((f) => {
      const aspects = [...f.aspects];
      aspects[i] = { ...aspects[i], [field]: value };
      return { ...f, aspects };
    });
  }

  // Varying aspect names
  function setVaryingAspect(i: number, value: string) {
    setForm((f) => {
      const varyingAspects = [...f.varyingAspects];
      varyingAspects[i] = value;
      return { ...f, varyingAspects };
    });
  }

  // Variation rows
  function setVariation(id: string, field: keyof Omit<VariationRow, 'id' | 'aspectValues'>, value: string) {
    setForm((f) => ({
      ...f,
      variations: f.variations.map((v) => v.id === id ? { ...v, [field]: value } : v),
    }));
  }

  function setVariationAspect(id: string, aspectName: string, value: string) {
    setForm((f) => ({
      ...f,
      variations: f.variations.map((v) =>
        v.id === id ? { ...v, aspectValues: { ...v.aspectValues, [aspectName]: value } } : v
      ),
    }));
  }

  function removeVariation(id: string) {
    setForm((f) => ({ ...f, variations: f.variations.filter((v) => v.id !== id) }));
  }

  async function handleCreateLocation() {
    if (!newLocation.key || !newLocation.name || !newLocation.postalCode) {
      toast.error('Fill in all location fields');
      return;
    }
    setCreatingLocation(true);
    try {
      const res = await fetch('/api/ebay/listings/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLocation),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message ?? 'Failed to create location');
      }
      toast.success('Location created');
      setShowAddLocation(false);
      setNewLocation({ key: '', name: '', postalCode: '', country: 'GB' });
      await loadMeta();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error creating location');
    } finally {
      setCreatingLocation(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const isVariation = form.listingType === 'variation';

    if (!form.sku || !form.title || !form.categoryId) {
      toast.error('SKU, title, and category are required');
      return;
    }
    if (!isVariation && !form.price) {
      toast.error('Price is required');
      return;
    }
    if (!form.paymentPolicyId || !form.returnPolicyId || !form.fulfillmentPolicyId) {
      toast.error('All three business policies must be selected');
      return;
    }
    if (!form.merchantLocationKey) {
      toast.error('A warehouse location must be selected');
      return;
    }

    const imageUrls = form.imageUrls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (imageUrls.length === 0) {
      toast.error('At least one image URL is required');
      return;
    }

    if (isVariation) {
      const varyingAspects = form.varyingAspects.map((a) => a.trim()).filter(Boolean);
      if (varyingAspects.length === 0) {
        toast.error('At least one varying aspect name is required (e.g. Color)');
        return;
      }
      if (form.variations.length < 2) {
        toast.error('At least two variations are required');
        return;
      }
      for (const v of form.variations) {
        for (const aspect of varyingAspects) {
          if (!v.aspectValues[aspect]?.trim()) {
            toast.error(`All variations need a value for "${aspect}"`);
            return;
          }
        }
        if (!v.price) { toast.error('All variations need a price'); return; }
      }
    }

    const aspects: Record<string, string[]> = {};
    for (const { key, value } of form.aspects) {
      if (key.trim() && value.trim()) aspects[key.trim()] = [value.trim()];
    }

    const varyingAspects = form.varyingAspects.map((a) => a.trim()).filter(Boolean);

    const variations = isVariation
      ? form.variations.map((v, i) => ({
          sku: `${form.sku}-${varyingAspects.map((a) => v.aspectValues[a] ?? '').join('-').replace(/\s+/g, '-')}${i}`,
          aspectValues: Object.fromEntries(varyingAspects.map((a) => [a, v.aspectValues[a] ?? ''])),
          price: Number(v.price),
          quantity: Number(v.quantity) || 1,
          imageUrl: v.imageUrl.trim() || undefined,
        }))
      : undefined;

    setSubmitting(true);
    try {
      const res = await fetch('/api/ebay/listings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: form.sku,
          title: form.title,
          description: form.description,
          condition: form.condition,
          quantity: Number(form.quantity) || 1,
          imageUrls,
          aspects,
          categoryId: form.categoryId,
          format: isVariation ? 'FIXED_PRICE' : form.format,
          price: Number(form.price),
          merchantLocationKey: form.merchantLocationKey,
          paymentPolicyId: form.paymentPolicyId,
          returnPolicyId: form.returnPolicyId,
          fulfillmentPolicyId: form.fulfillmentPolicyId,
          variations,
          varyingAspects: isVariation ? varyingAspects : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Failed at: ${data.step ?? 'unknown'}`);

      setResultListingId(data.listingId);
      toast.success(`Listing published! ID: ${data.listingId}`);
      setForm(INITIAL_FORM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Listing creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  const paymentPolicies = policies.filter((p) => p.policyType === 'PAYMENT');
  const returnPolicies = policies.filter((p) => p.policyType === 'RETURN_POLICY');
  const fulfillmentPolicies = policies.filter((p) => p.policyType === 'FULFILLMENT');
  const isVariation = form.listingType === 'variation';
  const varyingAspectNames = form.varyingAspects.map((a) => a.trim()).filter(Boolean);

  if (loadingMeta) {
    return <p className="text-sm text-slate-500 py-8 text-center">Loading eBay settings…</p>;
  }
  if (metaError) {
    return (
      <div className="py-8 space-y-4 max-w-md">
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {metaError}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={loadMeta}>Retry</Button>
          <a href="/import">
            <Button size="sm">Go to Import Orders →</Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {resultListingId && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-green-300 bg-green-50 text-green-800 text-sm">
          <span>Listing published — ID: <strong>{resultListingId}</strong></span>
          <a
            href={`https://www.ebay.co.uk/itm/${resultListingId}`}
            target="_blank" rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-green-700 hover:underline shrink-0"
          >
            View on eBay <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Listing Type ── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Listing Type</h2>
          <div className="flex gap-3">
            {(['single', 'variation'] as ListingType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setField('listingType', t)}
                className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${
                  form.listingType === t
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-400'
                }`}
              >
                {t === 'single' ? 'Single Item' : 'With Variations'}
              </button>
            ))}
          </div>
          {isVariation && (
            <p className="text-xs text-slate-500">
              Use this for listings with multiple options (e.g. different colours or sizes). All variations share the same title, description, and category.
            </p>
          )}
        </section>

        {/* ── Item Details ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Item Details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">
                {isVariation ? 'Base SKU * (group key)' : 'SKU *'}
              </label>
              <Input value={form.sku} onChange={(e) => setField('sku', e.target.value)} placeholder="MY-ITEM-001" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Condition *</label>
              <select
                value={form.condition}
                onChange={(e) => setField('condition', e.target.value as EbayListingCondition)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {(Object.entries(LISTING_CONDITION_LABELS) as [EbayListingCondition, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Title * <span className="text-slate-400">(max 80 chars)</span></label>
            <Input
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              maxLength={80}
              placeholder="Apple MacBook Pro 14-inch M3 Pro 512GB Space Black"
            />
            <p className="text-xs text-slate-400 text-right">{form.title.length}/80</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="Detailed item description…"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">
              {isVariation ? 'Main Listing Image URLs *' : 'Image URLs *'}{' '}
              <span className="text-slate-400">(one per line{isVariation ? ', shared across all variations' : ''})</span>
            </label>
            <textarea
              value={form.imageUrls}
              onChange={(e) => setField('imageUrls', e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none font-mono"
              placeholder="https://i.ebayimg.com/images/..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-600">
                {isVariation ? 'Common Item Aspects' : 'Item Aspects'}{' '}
                <span className="text-slate-400">(item specifics)</span>
              </label>
              <Button type="button" variant="outline" size="sm" onClick={() => setField('aspects', [...form.aspects, { key: '', value: '' }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            {isVariation && (
              <p className="text-xs text-slate-400">These apply to all variations. Do not include the aspects that vary (e.g. Colour, Size) — add those below.</p>
            )}
            {form.aspects.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input value={a.key} onChange={(e) => setAspect(i, 'key', e.target.value)} placeholder="e.g. Brand" className="flex-1" />
                <Input value={a.value} onChange={(e) => setAspect(i, 'value', e.target.value)} placeholder="e.g. Apple" className="flex-1" />
                {form.aspects.length > 1 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setField('aspects', form.aspects.filter((_, j) => j !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Variations ── */}
        {isVariation && (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Variations</h2>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600">Varying Aspect Names * <span className="text-slate-400">(e.g. Colour, Size)</span></label>
                <Button type="button" variant="outline" size="sm" onClick={() => setField('varyingAspects', [...form.varyingAspects, ''])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.varyingAspects.map((a, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input
                      value={a}
                      onChange={(e) => setVaryingAspect(i, e.target.value)}
                      placeholder="e.g. Colour"
                      className="w-36 h-8 text-sm"
                    />
                    {form.varyingAspects.length > 1 && (
                      <button type="button" onClick={() => setField('varyingAspects', form.varyingAspects.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Variation rows */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-600">Variation Rows *</label>
                <Button type="button" variant="outline" size="sm" onClick={() => setField('variations', [...form.variations, makeVariation()])}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Variation
                </Button>
              </div>

              {/* Header row */}
              {varyingAspectNames.length > 0 && (
                <div className="grid gap-2 text-xs font-medium text-slate-500 pb-1"
                  style={{ gridTemplateColumns: `${varyingAspectNames.map(() => '1fr').join(' ')} 80px 70px 1fr 32px` }}
                >
                  {varyingAspectNames.map((a) => <span key={a}>{a}</span>)}
                  <span>Price (£)</span>
                  <span>Qty</span>
                  <span>Image URL <span className="font-normal text-slate-400">(optional)</span></span>
                  <span />
                </div>
              )}

              {form.variations.map((v) => (
                <div key={v.id} className="grid gap-2 items-start"
                  style={{ gridTemplateColumns: `${(varyingAspectNames.length || 1) === 0 ? '1fr' : varyingAspectNames.map(() => '1fr').join(' ')} 80px 70px 1fr 32px` }}
                >
                  {varyingAspectNames.length === 0
                    ? <p className="text-xs text-slate-400 col-span-full">Define aspect names above first</p>
                    : varyingAspectNames.map((aspectName) => (
                      <Input
                        key={aspectName}
                        value={v.aspectValues[aspectName] ?? ''}
                        onChange={(e) => setVariationAspect(v.id, aspectName, e.target.value)}
                        placeholder={aspectName}
                        className="h-8 text-sm"
                      />
                    ))
                  }
                  <Input
                    type="number" min="0.01" step="0.01"
                    value={v.price}
                    onChange={(e) => setVariation(v.id, 'price', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-sm"
                  />
                  <Input
                    type="number" min="1"
                    value={v.quantity}
                    onChange={(e) => setVariation(v.id, 'quantity', e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Input
                    value={v.imageUrl}
                    onChange={(e) => setVariation(v.id, 'imageUrl', e.target.value)}
                    placeholder="https://…"
                    className="h-8 text-sm font-mono"
                  />
                  <Button
                    type="button" variant="outline" size="sm"
                    className="h-8 w-8 p-0"
                    disabled={form.variations.length <= 2}
                    onClick={() => removeVariation(v.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Offer Details ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Offer Details</h2>

          {!isVariation && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Format *</label>
                <select
                  value={form.format}
                  onChange={(e) => setField('format', e.target.value as EbayListingFormat)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="FIXED_PRICE">Fixed Price</option>
                  <option value="AUCTION">Auction</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Price (£) *</label>
                <Input
                  type="number" min="0.01" step="0.01"
                  value={form.price}
                  onChange={(e) => setField('price', e.target.value)}
                  placeholder="29.99"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Quantity *</label>
                <Input
                  type="number" min="1"
                  value={form.quantity}
                  onChange={(e) => setField('quantity', e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Category *</label>
            <CategorySearch
              categoryId={form.categoryId}
              categoryName={form.categoryName}
              onSelect={(id, name) => setForm((f) => ({ ...f, categoryId: id, categoryName: name }))}
              onClear={() => setForm((f) => ({ ...f, categoryId: '', categoryName: '' }))}
            />
          </div>
        </section>

        {/* ── Business Policies ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Business Policies</h2>
          {[
            { label: 'Payment Policy *', key: 'paymentPolicyId' as const, list: paymentPolicies },
            { label: 'Return Policy *', key: 'returnPolicyId' as const, list: returnPolicies },
            { label: 'Fulfillment Policy *', key: 'fulfillmentPolicyId' as const, list: fulfillmentPolicies },
          ].map(({ label, key, list }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium text-slate-600">{label}</label>
              {list.length === 0 ? (
                <p className="text-xs text-red-500">No policies found. Set them up in your eBay Seller Hub.</p>
              ) : (
                <select
                  value={form[key]}
                  onChange={(e) => setField(key, e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Select…</option>
                  {list.map((p) => <option key={p.policyId} value={p.policyId}>{p.name}</option>)}
                </select>
              )}
            </div>
          ))}
        </section>

        {/* ── Warehouse Location ── */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide border-b pb-2">Warehouse Location</h2>

          {locations.length === 0
            ? <p className="text-xs text-slate-500">No locations found. Create one below.</p>
            : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Location *</label>
                <select
                  value={form.merchantLocationKey}
                  onChange={(e) => setField('merchantLocationKey', e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                >
                  <option value="">Select…</option>
                  {locations.map((loc) => (
                    <option key={loc.merchantLocationKey} value={loc.merchantLocationKey}>
                      {loc.name} ({loc.merchantLocationKey})
                    </option>
                  ))}
                </select>
              </div>
            )
          }

          <Button type="button" variant="outline" size="sm" onClick={() => setShowAddLocation((v) => !v)}>
            {showAddLocation ? 'Cancel' : '+ Add Location'}
          </Button>

          {showAddLocation && (
            <div className="p-4 border rounded-lg space-y-3 bg-slate-50">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Location Key', field: 'key' as const, placeholder: 'WAREHOUSE-1' },
                  { label: 'Name', field: 'name' as const, placeholder: 'Main Warehouse' },
                  { label: 'Postcode', field: 'postalCode' as const, placeholder: 'SW1A 1AA' },
                  { label: 'Country', field: 'country' as const, placeholder: 'GB' },
                ].map(({ label, field, placeholder }) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">{label}</label>
                    <Input
                      value={newLocation[field]}
                      onChange={(e) => setNewLocation((l) => ({ ...l, [field]: e.target.value }))}
                      placeholder={placeholder}
                    />
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" onClick={handleCreateLocation} disabled={creatingLocation}>
                {creatingLocation ? 'Creating…' : 'Create Location'}
              </Button>
            </div>
          )}
        </section>

        <div className="pt-2 pb-8">
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting
              ? isVariation ? 'Publishing variation listing…' : 'Publishing listing…'
              : isVariation ? 'Publish Variation Listing on eBay' : 'Publish Listing on eBay'
            }
          </Button>
        </div>
      </form>
    </div>
  );
}
