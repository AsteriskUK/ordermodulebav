'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import {
  TicketRecord, TicketStatus, TicketPriority, Department,
  DEPARTMENT_CONFIG, TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG,
} from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TicketDialog } from './ticket-dialog';
import { Ticket as TicketIcon, Search, Plus, Phone, Mail, MessageSquare } from 'lucide-react';

const CONTACT_ICON = { phone: Phone, email: Mail, ebay_message: MessageSquare } as const;
const OPEN_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting'];

export function TicketsPanel() {
  const tickets = useOrderStore((s) => s.tickets);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const role = currentUser?.role;
  const canCreate = role === 'admin' || role === 'manager' || role === 'comms';
  const userDepts = useMemo<Department[]>(() => (
    currentUser ? (currentUser.departments?.length ? currentUser.departments : [currentUser.department]) : []
  ), [currentUser]);
  const seesAll = role === 'admin' || role === 'manager' || role === 'comms';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | TicketStatus>('active');
  const [deptFilter, setDeptFilter] = useState<'all' | 'mine' | Department>(seesAll ? 'all' : 'mine');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all');
  const [open, setOpen] = useState<TicketRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => {
    let list = tickets;

    // Staff only see their department's tickets or ones assigned to them
    if (!seesAll) {
      list = list.filter((t) =>
        (t.department && userDepts.includes(t.department)) || t.assigneeUserId === currentUser?.id
      );
    }

    if (deptFilter === 'mine') {
      list = list.filter((t) =>
        (t.department && userDepts.includes(t.department)) || t.assigneeUserId === currentUser?.id
      );
    } else if (deptFilter !== 'all') {
      list = list.filter((t) => t.department === deptFilter);
    }

    if (statusFilter === 'active') list = list.filter((t) => OPEN_STATUSES.includes(t.status));
    else if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter);

    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter);

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        t.subject.toLowerCase().includes(q) ||
        (t.buyerUsername ?? '').toLowerCase().includes(q) ||
        (t.salesRecordNumber ?? '').toLowerCase().includes(q) ||
        (t.orderNumber ?? '').toLowerCase().includes(q) ||
        (t.body ?? '').toLowerCase().includes(q)
      );
    }

    // Priority then most-recently updated
    const order: TicketPriority[] = ['urgent', 'high', 'normal', 'low'];
    return [...list].sort((a, b) => {
      const ap = order.indexOf(a.priority), bp = order.indexOf(b.priority);
      if (ap !== bp) return ap - bp;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [tickets, seesAll, userDepts, currentUser, deptFilter, statusFilter, priorityFilter, search]);

  const activeCount = tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-slate-400">
          {visible.length} ticket{visible.length !== 1 ? 's' : ''} · {activeCount} active
        </p>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="h-4 w-4 mr-1" /> New ticket
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder="Search subject, buyer, order…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="px-2 py-2 border border-slate-300 rounded-md text-sm">
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          {(Object.keys(TICKET_STATUS_CONFIG) as TicketStatus[]).map((s) => <option key={s} value={s}>{TICKET_STATUS_CONFIG[s].label}</option>)}
        </select>
        {seesAll && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value as typeof deptFilter)} className="px-2 py-2 border border-slate-300 rounded-md text-sm">
            <option value="all">All departments</option>
            <option value="mine">My departments</option>
            {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((d) => <option key={d} value={d}>{DEPARTMENT_CONFIG[d].label}</option>)}
          </select>
        )}
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)} className="px-2 py-2 border border-slate-300 rounded-md text-sm">
          <option value="all">Any priority</option>
          {(Object.keys(TICKET_PRIORITY_CONFIG) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY_CONFIG[p].label}</option>)}
        </select>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <TicketIcon className="h-12 w-12 mx-auto mb-3 text-slate-200" />
          <p className="font-medium">No tickets</p>
          <p className="text-sm mt-1">{canCreate ? 'Create a ticket or raise one from a buyer message.' : 'Nothing assigned to your team right now.'}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((t) => <TicketRow key={t.id} ticket={t} onOpen={() => setOpen(t)} />)}
        </div>
      )}

      {open && <TicketDialog ticket={open} onClose={() => setOpen(null)} />}
      {creating && <TicketDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function TicketRow({ ticket: t, onOpen }: { ticket: TicketRecord; onOpen: () => void }) {
  const st = TICKET_STATUS_CONFIG[t.status];
  const pr = TICKET_PRIORITY_CONFIG[t.priority];
  const ContactIcon = t.contactMethod ? CONTACT_ICON[t.contactMethod] : null;
  return (
    <button onClick={onOpen} className="w-full text-left border border-slate-200 rounded-xl px-4 py-3 bg-white hover:border-blue-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${pr.color}`}>{pr.label}</span>
            <span className="text-sm font-semibold text-slate-800 truncate">{t.subject}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
            {t.department && <span className={`px-1.5 py-0.5 rounded border ${DEPARTMENT_CONFIG[t.department].color}`}>{DEPARTMENT_CONFIG[t.department].label}</span>}
            {t.assigneeName && <span>· {t.assigneeName}</span>}
            {t.buyerUsername && <span>· {t.buyerUsername}</span>}
            {t.salesRecordNumber && <span>· #{t.salesRecordNumber}</span>}
            {ContactIcon && <ContactIcon className="h-3 w-3" />}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${st.color}`}>{st.label}</span>
          <span className="text-[10px] text-slate-400">{new Date(t.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
        </div>
      </div>
    </button>
  );
}
