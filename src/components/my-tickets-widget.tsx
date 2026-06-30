'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import {
  TicketRecord, TicketStatus, Department,
  DEPARTMENT_CONFIG, TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG,
} from '@/lib/types';
import { TicketDialog } from './ticket-dialog';
import { Ticket as TicketIcon, ChevronRight } from 'lucide-react';

const ACTIVE: TicketStatus[] = ['open', 'in_progress', 'waiting'];

export function MyTicketsWidget({ limit = 6 }: { limit?: number }) {
  const router = useRouter();
  const tickets = useOrderStore((s) => s.tickets);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const [open, setOpen] = useState<TicketRecord | null>(null);

  const role = currentUser?.role;
  const seesAll = role === 'admin' || role === 'manager' || role === 'comms';
  const userDepts = useMemo<Department[]>(() => (
    currentUser ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department]) : []
  ), [currentUser]);

  const relevant = useMemo(() => {
    const active = tickets.filter((t) => ACTIVE.includes(t.status));
    const mine = seesAll
      ? active
      : active.filter((t) => (t.department && userDepts.includes(t.department)) || t.assigneeUserId === currentUser?.id);
    const order = ['urgent', 'high', 'normal', 'low'];
    return [...mine].sort((a, b) => {
      const d = order.indexOf(a.priority) - order.indexOf(b.priority);
      return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [tickets, seesAll, userDepts, currentUser]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <TicketIcon className="h-4 w-4 text-blue-500" />
          {seesAll ? 'Active Tickets' : 'My Team Tickets'}
          {relevant.length > 0 && (
            <span className="bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full px-1.5 py-0.5">{relevant.length}</span>
          )}
        </h3>
        <button onClick={() => router.push('/notes')} className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-0.5">
          All <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {relevant.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">No active tickets for your team 🎉</p>
      ) : (
        <div className="space-y-1.5">
          {relevant.slice(0, limit).map((t) => {
            const pr = TICKET_PRIORITY_CONFIG[t.priority];
            const st = TICKET_STATUS_CONFIG[t.status];
            return (
              <button
                key={t.id}
                onClick={() => setOpen(t)}
                className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${pr.color}`}>{pr.label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-700 truncate">{t.subject}</p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {t.department ? DEPARTMENT_CONFIG[t.department].label : 'Unassigned'}
                    {t.assigneeName ? ` · ${t.assigneeName}` : ''}
                    {t.buyerUsername ? ` · ${t.buyerUsername}` : ''}
                  </p>
                </div>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${st.color}`}>{st.label}</span>
              </button>
            );
          })}
          {relevant.length > limit && (
            <button onClick={() => router.push('/notes')} className="w-full text-center text-[11px] text-slate-400 hover:text-blue-600 pt-1">
              +{relevant.length - limit} more
            </button>
          )}
        </div>
      )}

      {open && <TicketDialog ticket={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
