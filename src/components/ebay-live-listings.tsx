'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Search, ExternalLink, Package } from 'lucide-react';
import { toast } from 'sonner';

interface LiveListing {
  sku: string;
  item_id?: string;
  title?: string;
  description?: string;
  image_url?: string;
  additional_images?: string[];
  price?: number;
  currency?: string;
  quantity?: number;
  condition?: string;
  listing_status?: string;
  listing_type?: string;
  category_id?: string;
  category_name?: string;
  listing_url?: string;
  last_synced_at?: string;
  created_at?: string;
}

interface Summary {
  active: number;
  total: number;
  lastSyncedAt: string | null;
}

export function EbayLiveListings() {
  const [listings, setListings] = useState<LiveListing[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function loadListings(reset = false) {
    setLoading(true);
    try {
      const newOffset = reset ? 0 : offset;
      const params = new URLSearchParams({ limit: String(limit), offset: String(newOffset) });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/ebay/live-listings?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load listings');
      const data = await res.json();
      setListings(reset ? data.listings : [...listings, ...data.listings]);
      setTotal(data.total);
      if (reset) setOffset(0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary() {
    try {
      const res = await fetch('/api/ebay/listings/sync');
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch {
      // silent
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/ebay/listings/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sync failed');
      toast.success(`Synced ${data.synced} live listings${data.inactive ? `, ${data.inactive} marked inactive` : ''}`);
      await loadListings(true);
      await loadSummary();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadSummary();
    loadListings(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadListings(true), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">eBay Live Listings</h2>
          {summary && (
            <p className="text-xs text-slate-500 mt-0.5">
              {summary.active} active · {summary.total} total
              {summary.lastSyncedAt && (
                <span className="ml-1">· synced {new Date(summary.lastSyncedAt).toLocaleString('en-GB')}</span>
              )}
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from eBay'}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search by title or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <div
            key={listing.sku}
            className="border rounded-lg bg-white p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start gap-3">
              {listing.image_url ? (
                <img
                  src={listing.image_url}
                  alt={listing.title}
                  className="h-16 w-16 rounded-md object-contain border bg-slate-50 shrink-0"
                />
              ) : (
                <div className="h-16 w-16 rounded-md border bg-slate-50 flex items-center justify-center shrink-0">
                  <Package className="h-6 w-6 text-slate-300" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-snug">
                  {listing.title || 'Untitled listing'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{listing.sku}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="outline" className="text-xs font-normal">
                    {listing.listing_status || 'active'}
                  </Badge>
                  {listing.condition && (
                    <Badge variant="outline" className="text-xs font-normal bg-slate-50">
                      {listing.condition}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-600">
              <div className="bg-slate-50 rounded p-2 text-center">
                <p className="text-slate-400">Price</p>
                <p className="font-medium">
                  {listing.price !== null && listing.price !== undefined
                    ? `£${listing.price.toFixed(2)}`
                    : '—'}
                </p>
              </div>
              <div className="bg-slate-50 rounded p-2 text-center">
                <p className="text-slate-400">Qty</p>
                <p className="font-medium">{listing.quantity ?? 0}</p>
              </div>
              <div className="bg-slate-50 rounded p-2 text-center">
                <p className="text-slate-400">Item ID</p>
                <p className="font-medium truncate">{listing.item_id || '—'}</p>
              </div>
            </div>

            {listing.listing_url && (
              <a
                href={listing.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center text-xs text-blue-600 hover:text-blue-800"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                View on eBay
              </a>
            )}
          </div>
        ))}
      </div>

      {listings.length === 0 && !loading && (
        <div className="text-center py-12 border border-dashed rounded-lg text-slate-400">
          <p className="text-sm">No live listings found.</p>
          <p className="text-xs mt-1">Click "Sync from eBay" to pull your active listings.</p>
        </div>
      )}

      {listings.length < total && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOffset((o) => o + limit);
              loadListings();
            }}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
