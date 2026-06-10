'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ORDER_STATUS_CONFIG } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  X,
  Package,
  PackageOpen,
  LayoutDashboard,
  Upload,
  ClipboardList,
  Workflow,
  Truck,
  FileBarChart2,
  Users,
  BarChart2,
  ArrowRight,
} from 'lucide-react';

const PAGES = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard, keywords: 'home overview' },
  { label: 'Import Orders', href: '/import', icon: Upload, keywords: 'csv upload import ebay backmarket' },
  { label: 'Order Sheet', href: '/orders', icon: ClipboardList, keywords: 'orders list table' },
  { label: 'Queue', href: '/packaging', icon: Workflow, keywords: 'queue packaging pipeline assemble check pack' },
  { label: 'Batch Shipping', href: '/shipping', icon: Truck, keywords: 'shipping ship labels dpd fedex' },
  { label: 'Batches', href: '/batches', icon: Package, keywords: 'batches imports history' },
  { label: 'Returns', href: '/returns', icon: PackageOpen, keywords: 'returns refunds rejected' },
  { label: 'Reports', href: '/reports', icon: BarChart2, keywords: 'reports revenue productivity categories' },
  { label: 'EOD Report', href: '/eod', icon: FileBarChart2, keywords: 'end of day report daily summary' },
  { label: 'Users & Roles', href: '/users', icon: Users, keywords: 'users roles staff admin permissions' },
];

type ResultKind = 'page' | 'order' | 'return';

interface Result {
  kind: ResultKind;
  id: string;
  label: string;
  sub: string;
  href: string;
  badge?: string;
  badgeColor?: string;
  icon: React.ElementType;
}

export function GlobalSearch() {
  const router = useRouter();
  const orders = useOrderStore((s) => s.orders);
  const returns = useOrderStore((s) => s.returns);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Show pages by default
      return PAGES.map((p) => ({
        kind: 'page' as ResultKind,
        id: p.href,
        label: p.label,
        sub: 'Page',
        href: p.href,
        icon: p.icon,
      }));
    }

    const out: Result[] = [];

    // Pages
    for (const p of PAGES) {
      if (p.label.toLowerCase().includes(q) || p.keywords.toLowerCase().includes(q)) {
        out.push({ kind: 'page', id: p.href, label: p.label, sub: 'Page', href: p.href, icon: p.icon });
      }
    }

    // Orders
    const matchedOrders = orders.filter((o) =>
      o.salesRecordNumber.toLowerCase().includes(q) ||
      o.orderNumber.toLowerCase().includes(q) ||
      o.postToName.toLowerCase().includes(q) ||
      o.buyerUsername.toLowerCase().includes(q) ||
      o.buyerEmail.toLowerCase().includes(q) ||
      o.itemTitle.toLowerCase().includes(q) ||
      o.postToPostcode.toLowerCase().includes(q) ||
      o.trackingNumber.toLowerCase().includes(q) ||
      o.customLabel.toLowerCase().includes(q)
    ).slice(0, 8);

    for (const o of matchedOrders) {
      const cfg = ORDER_STATUS_CONFIG[o.status];
      out.push({
        kind: 'order',
        id: o.id,
        label: `#${o.salesRecordNumber} — ${o.postToName}`,
        sub: o.itemTitle.length > 60 ? o.itemTitle.slice(0, 60) + '…' : o.itemTitle,
        href: `/orders`,
        badge: cfg.label,
        badgeColor: cfg.color,
        icon: Package,
      });
    }

    // Returns
    const matchedReturns = returns.filter((r) =>
      r.salesRecordNumber.toLowerCase().includes(q) ||
      r.itemTitle.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q)
    ).slice(0, 4);

    for (const r of matchedReturns) {
      out.push({
        kind: 'return',
        id: r.id,
        label: `Return #${r.salesRecordNumber}`,
        sub: r.reason,
        href: '/returns',
        badge: r.status,
        badgeColor: 'bg-rose-100 text-rose-800 border-rose-300',
        icon: PackageOpen,
      });
    }

    return out;
  }, [query, orders, returns]);

  useEffect(() => { setActive(0); }, [results]);

  const navigate = useCallback((result: Result) => {
    setOpen(false);
    router.push(result.href);
  }, [router]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      navigate(results[active]);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors text-sm w-full"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden sm:flex items-center gap-0.5 rounded border border-slate-600 px-1.5 py-0.5 text-xs font-mono text-slate-500">
          ⌘K
        </kbd>
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="w-full max-w-xl mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]">
            {/* Input row */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Search orders, customers, postcodes, pages…"
                className="flex-1 bg-transparent outline-none text-sm text-slate-900 placeholder:text-slate-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              )}
              <kbd
                className="rounded border border-slate-200 px-1.5 py-0.5 text-xs font-mono text-slate-400 cursor-pointer hover:bg-slate-50"
                onClick={() => setOpen(false)}
              >
                Esc
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="overflow-y-auto flex-1">
              {results.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">No results for "{query}"</div>
              ) : (
                <div className="py-1.5">
                  {/* Section headers */}
                  {(['page', 'order', 'return'] as ResultKind[]).map((kind) => {
                    const group = results.filter((r) => r.kind === kind);
                    if (group.length === 0) return null;
                    const sectionLabel = kind === 'page' ? 'Pages' : kind === 'order' ? 'Orders' : 'Returns';
                    return (
                      <div key={kind}>
                        <div className="px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                          {sectionLabel}
                        </div>
                        {group.map((result) => {
                          const idx = results.indexOf(result);
                          const Icon = result.icon;
                          const isActive = idx === active;
                          return (
                            <button
                              key={result.id}
                              data-index={idx}
                              onClick={() => navigate(result)}
                              onMouseEnter={() => setActive(idx)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                                isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-blue-100' : 'bg-slate-100'}`}>
                                <Icon className={`h-4 w-4 ${isActive ? 'text-blue-600' : 'text-slate-500'}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${isActive ? 'text-blue-900' : 'text-slate-800'}`}>
                                  {result.label}
                                </p>
                                <p className="text-xs text-slate-400 truncate">{result.sub}</p>
                              </div>
                              {result.badge && (
                                <Badge variant="outline" className={`text-xs shrink-0 ${result.badgeColor}`}>
                                  {result.badge}
                                </Badge>
                              )}
                              {isActive && <ArrowRight className="h-3.5 w-3.5 text-blue-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50 text-xs text-slate-400">
              <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 px-1 font-mono">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 px-1 font-mono">↵</kbd> open</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-slate-200 px-1 font-mono">Esc</kbd> close</span>
              <span className="ml-auto">{results.length} result{results.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
