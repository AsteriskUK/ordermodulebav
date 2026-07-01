'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { ORDER_STATUS_CONFIG, OrderStatus } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, Search, ChevronLeft, ChevronRight, Loader2, Globe, ChevronDown } from 'lucide-react';

const PAGE_SIZE = 50;

interface OrderRow {
  id: string;
  sales_record_number: string;
  order_number: string | null;
  sale_date: string | null;
  paid_on_date: string | null;
  buyer_username: string | null;
  buyer_name: string | null;
  item_title: string | null;
  variation: string | null;
  category: string | null;
  status: OrderStatus;
  total_price: number | null;
  post_to_name: string | null;
  post_to_postcode: string | null;
  post_to_country: string | null;
  is_gsp: boolean | null;
}

const SELECT = 'id,sales_record_number,order_number,sale_date,paid_on_date,buyer_username,buyer_name,item_title,variation,category,status,total_price,post_to_name,post_to_postcode,post_to_country,is_gsp';

export function HistoricalOrders() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let q = supabase.from('orders').select(SELECT, { count: 'exact' });

      if (statusFilter !== 'all') q = q.eq('status', statusFilter);

      if (debounced) {
        // Strip characters that would break the PostgREST or() grammar.
        const safe = debounced.replace(/[(),*%]/g, ' ').trim();
        if (safe) {
          q = q.or(
            ['sales_record_number', 'order_number', 'buyer_username', 'buyer_name', 'item_title']
              .map((c) => `${c}.ilike.%${safe}%`)
              .join(',')
          );
        }
      }

      const from = page * PAGE_SIZE;
      const { data, count, error: err } = await q
        .order('sale_date', { ascending: false, nullsFirst: false })
        .range(from, from + PAGE_SIZE - 1);

      if (err) { setError(err.message); setRows([]); setTotal(0); }
      else { setRows((data ?? []) as OrderRow[]); setTotal(count ?? 0); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [debounced, statusFilter, page]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const statusOptions = useMemo(() => Object.keys(ORDER_STATUS_CONFIG) as OrderStatus[], []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <History className="h-6 w-6 text-blue-500" /> Historical Orders
        </h2>
        <p className="text-slate-500 text-sm mt-1">Search every order in the database — {total.toLocaleString()} match{total === 1 ? '' : 'es'}.</p>
      </div>

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search record #, order #, buyer, item…" className="pl-9" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0); }} className="px-3 py-2 border border-slate-300 rounded-md text-sm">
          <option value="all">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{ORDER_STATUS_CONFIG[s].label}</option>)}
        </select>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Results */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="grid grid-cols-[110px_1fr_130px_90px_90px] gap-2 px-4 py-2 bg-slate-50 border-b text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
          <span>Record #</span><span>Item / Buyer</span><span>Date</span><span>Status</span><span className="text-right">Total</span>
        </div>

        {loading ? (
          <div className="py-16 text-center text-slate-400"><Loader2 className="h-6 w-6 mx-auto animate-spin mb-2" /><p className="text-sm">Searching…</p></div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No orders match.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((o) => {
              const st = ORDER_STATUS_CONFIG[o.status] ?? { label: o.status, color: 'bg-slate-100 text-slate-700 border-slate-200' };
              const open = expanded === o.id;
              return (
                <div key={o.id}>
                  <button onClick={() => setExpanded(open ? null : o.id)} className="w-full grid grid-cols-[110px_1fr_130px_90px_90px] gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50 items-center">
                    <span className="font-mono text-xs text-blue-700 flex items-center gap-1">
                      <ChevronDown className={`h-3 w-3 text-slate-300 transition-transform ${open ? '' : '-rotate-90'}`} />
                      {o.sales_record_number}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">{o.item_title || '—'}</span>
                      <span className="block truncate text-xs text-slate-400">{o.buyer_username || o.buyer_name || '—'}{o.is_gsp ? ' · GSP' : ''}</span>
                    </span>
                    <span className="text-xs text-slate-500">{fmtDate(o.sale_date || o.paid_on_date)}</span>
                    <span><Badge variant="outline" className={`text-[10px] ${st.color}`}>{st.label}</Badge></span>
                    <span className="text-right font-medium text-slate-700">{o.total_price != null ? `£${Number(o.total_price).toFixed(2)}` : '—'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-3 pt-1 bg-slate-50 text-xs text-slate-600 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                      <span><span className="text-slate-400">Order #:</span> {o.order_number || '—'}</span>
                      <span><span className="text-slate-400">Category:</span> {o.category || '—'}</span>
                      <span><span className="text-slate-400">Ship to:</span> {o.post_to_name || '—'}{o.post_to_postcode ? `, ${o.post_to_postcode}` : ''}</span>
                      <span className="flex items-center gap-1">{o.is_gsp && <Globe className="h-3 w-3 text-blue-500" />}<span className="text-slate-400">Country:</span> {o.post_to_country || '—'}</span>
                      {o.variation && <span className="sm:col-span-2"><span className="text-slate-400">Variation:</span> {o.variation}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Page {page + 1} of {pageCount.toLocaleString()}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="h-4 w-4" /> Prev</Button>
            <Button variant="outline" size="sm" disabled={page + 1 >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
