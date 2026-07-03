'use client';

import { useEffect, useState } from 'react';
import { CatalogProduct } from '@/lib/types';
import { fetchCatalogPage, fetchCatalogCategories } from '@/lib/catalog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Library, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 50;

export function CatalogBrowser() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState('all');
  const [categories, setCategories] = useState<string[]>([]);
  const [rows, setRows] = useState<CatalogProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchCatalogCategories().then(setCategories); }, []);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(0); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchCatalogPage({ q: debouncedQ, category, page, pageSize: PAGE_SIZE }).then((res) => {
      if (!live) return;
      setRows(res.rows);
      setTotal(res.total);
      setLoading(false);
    });
    return () => { live = false; };
  }, [debouncedQ, category, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder="Search catalog by name…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(0); }}
          className="px-3 py-2 border border-slate-300 rounded-md text-sm capitalize"
        >
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
        </select>
      </div>

      <p className="text-xs text-slate-500">
        {loading ? 'Loading…' : `${total.toLocaleString()} products`}
        {category !== 'all' ? ` in ${category}` : ''}{debouncedQ ? ` matching “${debouncedQ}”` : ''}
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Library className="h-12 w-12 mx-auto mb-3 text-slate-200" />
          <p className="font-medium">No catalog products</p>
          <p className="text-sm mt-1">Import a scrape with <span className="font-mono">scripts/import-catalog.mjs</span>.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {rows.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border border-slate-200 rounded-xl bg-white px-3 py-2.5">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" className="h-11 w-11 object-contain rounded shrink-0" />
              ) : (
                <div className="h-11 w-11 rounded bg-slate-100 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{p.name}</p>
                <p className="text-[11px] text-slate-400 truncate">
                  <span className="uppercase">{p.category}</span>
                  {Object.values(p.specs).slice(0, 3).map((v) => ` · ${v}`).join('')}
                </p>
              </div>
              {p.msrp != null && <span className="text-xs text-slate-500 shrink-0">£{p.msrp}</span>}
            </div>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-xs text-slate-500">Page {page + 1} of {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount - 1 || loading} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
