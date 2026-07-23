'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TicketRecord, TicketContactMethod, Department } from '@/lib/types';
import { TicketDialog } from './ticket-dialog';
import { CancellationDialog } from './cancellation-dialog';
import { Phone, RotateCcw, Banknote, XCircle, PackageMinus, Zap, Ticket } from 'lucide-react';

/** Context a quick action can prefill onto a ticket. Any field may be omitted. */
export interface QuickActionContext {
  buyerUsername?: string;
  buyerName?: string;
  orderId?: string;
  salesRecordNumber?: string;
  orderNumber?: string;
  itemTitle?: string;
  ebayConversationId?: string;
  /** Phone/email to prefill the contact value when known */
  contactPhone?: string;
  contactEmail?: string;
  /** Optional message/body to seed the ticket details */
  note?: string;
}

interface Preset {
  key: string;
  label: string;
  icon: typeof Phone;
  color: string;
  /**
   * 'ticket' opens the ticket dialog (for actions with no dedicated workflow page).
   * 'nav' deep-links to the relevant module, prefilling a new record from context.
   * 'cancel' opens the pre-shipment cancellation dialog (no return case involved).
   */
  mode: 'ticket' | 'nav' | 'cancel';
  // Ticket-mode fields
  category?: string;
  contactMethod?: TicketContactMethod;
  department?: Department;
  priority?: TicketRecord['priority'];
  // Nav-mode fields
  navPath?: string;
  /** 'kind' seeds the returns form notes (return / refund / cancel) */
  navKind?: 'return' | 'refund' | 'cancel';
}

const PRESETS: Preset[] = [
  { key: 'ticket',   label: 'Ticket',      icon: Ticket,       color: 'text-blue-700 border-blue-200 hover:bg-blue-50',          mode: 'ticket', category: 'question',  contactMethod: 'ebay_message' },
  { key: 'callback', label: 'Callback',    icon: Phone,        color: 'text-emerald-700 border-emerald-200 hover:bg-emerald-50', mode: 'ticket', category: 'callback',  contactMethod: 'phone', department: 'comms', priority: 'high' },
  { key: 'return',   label: 'Return',      icon: RotateCcw,    color: 'text-rose-700 border-rose-200 hover:bg-rose-50',          mode: 'nav', navPath: '/returns',      navKind: 'return' },
  { key: 'refund',   label: 'Refund',      icon: Banknote,     color: 'text-amber-700 border-amber-200 hover:bg-amber-50',       mode: 'nav', navPath: '/returns',      navKind: 'refund' },
  { key: 'cancel',   label: 'Cancel',      icon: XCircle,      color: 'text-red-700 border-red-200 hover:bg-red-50',             mode: 'cancel' },
  { key: 'missing',  label: 'Missing item',icon: PackageMinus, color: 'text-orange-700 border-orange-200 hover:bg-orange-50',    mode: 'nav', navPath: '/missing-items' },
];

/** Build a deep-link that opens a prefilled "new record" form in the target module. */
function buildNavHref(p: Preset, ctx: QuickActionContext): string {
  const params = new URLSearchParams({ new: '1' });
  const order = ctx.salesRecordNumber || ctx.orderNumber;
  if (order) params.set('order', order);
  if (ctx.buyerUsername) params.set('buyer', ctx.buyerUsername);
  if (ctx.note) params.set('notes', ctx.note);
  if (p.navKind) params.set('kind', p.navKind);
  return `${p.navPath}?${params.toString()}`;
}

export function QuickActions({ context, label = true, className = '' }: { context: QuickActionContext; label?: boolean; className?: string }) {
  const router = useRouter();
  const [prefill, setPrefill] = useState<Partial<TicketRecord> | null>(null);
  const [showCancel, setShowCancel] = useState(false);

  function open(p: Preset) {
    if (p.mode === 'nav') {
      router.push(buildNavHref(p, context));
      return;
    }
    if (p.mode === 'cancel') {
      setShowCancel(true);
      return;
    }
    const contactValue = p.contactMethod === 'phone' ? (context.contactPhone ?? '')
      : p.contactMethod === 'email' ? (context.contactEmail ?? '')
      : (context.buyerUsername ?? '');
    setPrefill({
      subject: `${p.label}${context.buyerUsername ? ` — ${context.buyerUsername}` : context.salesRecordNumber ? ` — #${context.salesRecordNumber}` : ''}`,
      body: context.note,
      category: p.category,
      priority: p.priority ?? 'normal',
      department: p.department,
      contactMethod: p.contactMethod,
      contactValue: contactValue || undefined,
      buyerUsername: context.buyerUsername,
      buyerName: context.buyerName,
      orderId: context.orderId,
      salesRecordNumber: context.salesRecordNumber,
      orderNumber: context.orderNumber,
      itemTitle: context.itemTitle,
      ebayConversationId: context.ebayConversationId,
    });
  }

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {label && <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1 mr-0.5"><Zap className="h-3 w-3" /> Quick action:</span>}
      {PRESETS.map((p) => {
        const Icon = p.icon;
        return (
          <button
            key={p.key}
            onClick={() => open(p)}
            className={`inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs font-medium transition-colors ${p.color}`}
            title={p.mode === 'nav' ? `Open ${p.label.toLowerCase()}` : `Create ${p.label.toLowerCase()} ticket`}
          >
            <Icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        );
      })}
      {prefill && <TicketDialog prefill={prefill} onClose={() => setPrefill(null)} />}
      {showCancel && <CancellationDialog context={context} onClose={() => setShowCancel(false)} />}
    </div>
  );
}
