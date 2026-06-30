'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import {
  TicketRecord, TicketStatus, TicketPriority, TicketContactMethod,
  Department, DEPARTMENT_CONFIG, TICKET_STATUS_CONFIG, TICKET_PRIORITY_CONFIG,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { X, Phone, Mail, MessageSquare, Trash2, Clock, UserPlus, StickyNote, Plus } from 'lucide-react';

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const CATEGORIES = [
  { value: 'wrong-item', label: 'Wrong item' },
  { value: 'damaged', label: 'Damaged / faulty' },
  { value: 'not-received', label: 'Not received' },
  { value: 'missing-parts', label: 'Missing parts' },
  { value: 'wrong-address', label: 'Address issue' },
  { value: 'refund-request', label: 'Refund request' },
  { value: 'return-request', label: 'Return request' },
  { value: 'question', label: 'General question' },
  { value: 'other', label: 'Other' },
];

const CONTACT_METHODS: { value: TicketContactMethod; label: string; icon: typeof Phone }[] = [
  { value: 'phone', label: 'Phone call', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'ebay_message', label: 'eBay message', icon: MessageSquare },
];

const ACTIVITY_ICON = { create: Plus, status: Clock, assign: UserPlus, note: StickyNote } as const;

const fieldCls = 'w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'text-xs font-medium text-slate-500 block mb-1';

export function TicketDialog({
  ticket,
  prefill,
  onClose,
}: {
  ticket?: TicketRecord | null;
  prefill?: Partial<TicketRecord>;
  onClose: () => void;
}) {
  const users = useOrderStore((s) => s.users);
  const orders = useOrderStore((s) => s.orders);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const addTicket = useOrderStore((s) => s.addTicket);
  const updateTicket = useOrderStore((s) => s.updateTicket);
  const deleteTicket = useOrderStore((s) => s.deleteTicket);

  const isEdit = !!ticket;
  const role = currentUser?.role;
  // Comms + admin + manager can create and (re)assign tickets to any team.
  const canManage = role === 'admin' || role === 'manager' || role === 'comms';
  const canDelete = role === 'admin' || role === 'manager';

  const base = ticket ?? prefill ?? {};
  const [subject, setSubject] = useState(base.subject ?? '');
  const [body, setBody] = useState(base.body ?? '');
  const [category, setCategory] = useState(base.category ?? 'other');
  const [priority, setPriority] = useState<TicketPriority>(base.priority ?? 'normal');
  const [status, setStatus] = useState<TicketStatus>(base.status ?? 'open');
  const [department, setDepartment] = useState<Department | ''>(base.department ?? '');
  const [assigneeUserId, setAssigneeUserId] = useState(base.assigneeUserId ?? '');
  const [contactMethod, setContactMethod] = useState<TicketContactMethod>(base.contactMethod ?? 'ebay_message');
  const [contactValue, setContactValue] = useState(base.contactValue ?? base.buyerUsername ?? '');
  const [orderId, setOrderId] = useState(base.orderId ?? '');
  const [buyerUsername, setBuyerUsername] = useState(base.buyerUsername ?? '');
  const [newNote, setNewNote] = useState('');

  // Members of the chosen department (plus anyone, so managers aren't blocked)
  const deptMembers = useMemo(() => {
    if (!department) return users;
    return users.filter((u) =>
      (u.departments?.length ? u.departments : [u.department]).includes(department as Department)
    );
  }, [users, department]);

  const linkedOrder = orders.find((o) => o.id === orderId);

  function persistAssignee(deptVal: Department | '', userId: string): { assigneeName?: string } {
    const u = users.find((x) => x.id === userId);
    return { assigneeName: u?.name };
  }

  function handleCreate() {
    if (!subject.trim()) { toast.error('Add a subject'); return; }
    if (!currentUser) { toast.error('Sign in first'); return; }
    const now = new Date().toISOString();
    const rec: TicketRecord = {
      id: generateId(),
      subject: subject.trim(),
      body: body.trim() || undefined,
      category,
      status,
      priority,
      department: department || undefined,
      assigneeUserId: assigneeUserId || undefined,
      assigneeName: persistAssignee(department, assigneeUserId).assigneeName,
      contactMethod,
      contactValue: contactValue.trim() || undefined,
      orderId: orderId || undefined,
      salesRecordNumber: linkedOrder?.salesRecordNumber ?? base.salesRecordNumber,
      orderNumber: linkedOrder?.orderNumber ?? base.orderNumber,
      ebayConversationId: base.ebayConversationId,
      buyerUsername: buyerUsername.trim() || undefined,
      buyerName: base.buyerName,
      itemTitle: linkedOrder?.itemTitle ?? base.itemTitle,
      createdById: currentUser.id,
      createdByName: currentUser.name,
      activity: [{ at: now, byId: currentUser.id, byName: currentUser.name, type: 'create', text: 'Ticket created' }],
      createdAt: now,
      updatedAt: now,
    };
    addTicket(rec);
    toast.success('Ticket created');
    onClose();
  }

  function patch(updates: Partial<TicketRecord>, activityText?: string, activityType: 'note' | 'status' | 'assign' = 'note') {
    if (!ticket) return;
    updateTicket(
      ticket.id,
      updates,
      activityText ? { byId: currentUser?.id, byName: currentUser?.name, type: activityType, text: activityText } : undefined
    );
  }

  function handleStatusChange(next: TicketStatus) {
    setStatus(next);
    patch({ status: next }, `Status → ${TICKET_STATUS_CONFIG[next].label}`, 'status');
  }

  function handleReassign(nextDept: Department | '', nextUserId: string) {
    const name = users.find((u) => u.id === nextUserId)?.name;
    const deptLabel = nextDept ? DEPARTMENT_CONFIG[nextDept as Department].label : 'Unassigned';
    patch(
      { department: nextDept || undefined, assigneeUserId: nextUserId || undefined, assigneeName: name },
      `Assigned to ${deptLabel}${name ? ` · ${name}` : ''}`,
      'assign'
    );
  }

  function handleAddNote() {
    if (!newNote.trim()) return;
    patch({}, newNote.trim(), 'note');
    setNewNote('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">{isEdit ? 'Ticket' : 'New ticket'}</h2>
            {isEdit && (
              <p className="text-xs text-slate-400 mt-0.5">
                #{ticket!.id.slice(0, 8)} · opened {new Date(ticket!.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {ticket!.createdByName ? ` by ${ticket!.createdByName}` : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEdit && canDelete && (
              <button
                onClick={() => { if (confirm('Delete this ticket?')) { deleteTicket(ticket!.id); onClose(); } }}
                className="text-slate-400 hover:text-red-500" title="Delete ticket"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Subject + body */}
          <div>
            <label className={labelCls}>Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of the issue" disabled={isEdit && !canManage} />
          </div>
          <div>
            <label className={labelCls}>Details</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${fieldCls} resize-none`} placeholder="What did the customer report?" disabled={isEdit && !canManage} />
          </div>

          {/* Category / priority / status */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls} disabled={isEdit && !canManage}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select
                value={priority}
                onChange={(e) => { const p = e.target.value as TicketPriority; setPriority(p); if (isEdit) patch({ priority: p }, `Priority → ${TICKET_PRIORITY_CONFIG[p].label}`, 'note'); }}
                className={fieldCls}
              >
                {(Object.keys(TICKET_PRIORITY_CONFIG) as TicketPriority[]).map((p) => <option key={p} value={p}>{TICKET_PRIORITY_CONFIG[p].label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select
                value={status}
                onChange={(e) => isEdit ? handleStatusChange(e.target.value as TicketStatus) : setStatus(e.target.value as TicketStatus)}
                className={fieldCls}
              >
                {(Object.keys(TICKET_STATUS_CONFIG) as TicketStatus[]).map((s) => <option key={s} value={s}>{TICKET_STATUS_CONFIG[s].label}</option>)}
              </select>
            </div>
          </div>

          {/* Assignment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Department</label>
              <select
                value={department}
                onChange={(e) => {
                  const d = e.target.value as Department | '';
                  setDepartment(d); setAssigneeUserId('');
                  if (isEdit && canManage) handleReassign(d, '');
                }}
                className={fieldCls}
                disabled={isEdit && !canManage}
              >
                <option value="">— Unassigned —</option>
                {(Object.keys(DEPARTMENT_CONFIG) as Department[]).map((d) => <option key={d} value={d}>{DEPARTMENT_CONFIG[d].label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Assign to (optional)</label>
              <select
                value={assigneeUserId}
                onChange={(e) => {
                  const uid = e.target.value;
                  setAssigneeUserId(uid);
                  if (isEdit && canManage) handleReassign(department, uid);
                }}
                className={fieldCls}
                disabled={isEdit && !canManage}
              >
                <option value="">Anyone in department</option>
                {deptMembers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {/* Preferred contact */}
          <div>
            <label className={labelCls}>Preferred contact method</label>
            <div className="flex gap-2">
              {CONTACT_METHODS.map((m) => {
                const Icon = m.icon;
                const active = contactMethod === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { setContactMethod(m.value); if (isEdit) patch({ contactMethod: m.value }, `Contact method → ${m.label}`, 'note'); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.label}
                  </button>
                );
              })}
            </div>
            <Input
              value={contactValue}
              onChange={(e) => setContactValue(e.target.value)}
              onBlur={() => { if (isEdit) patch({ contactValue: contactValue.trim() || undefined }); }}
              placeholder={contactMethod === 'phone' ? 'Phone number' : contactMethod === 'email' ? 'Email address' : 'eBay username'}
              className="mt-2"
            />
          </div>

          {/* Order linkage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Linked order (optional)</label>
              <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={fieldCls} disabled={isEdit && !canManage}>
                <option value="">— None —</option>
                {orders
                  .filter((o) => !o.deletedAt)
                  .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                  .slice(0, 100)
                  .map((o) => <option key={o.id} value={o.id}>#{o.salesRecordNumber} — {o.itemTitle.slice(0, 45)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Buyer username</label>
              <Input value={buyerUsername} onChange={(e) => setBuyerUsername(e.target.value)} placeholder="eBay username" disabled={isEdit && !canManage} />
            </div>
          </div>

          {/* Activity log (edit mode) */}
          {isEdit && (
            <div className="border-t pt-4">
              <label className={labelCls}>Activity</label>
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {[...ticket!.activity].reverse().map((a, i) => {
                  const Icon = ACTIVITY_ICON[a.type] ?? StickyNote;
                  return (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Icon className="h-3.5 w-3.5 mt-0.5 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-slate-700">{a.text}</p>
                        <p className="text-slate-400">{a.byName ?? 'System'} · {new Date(a.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }} placeholder="Add a note (e.g. called buyer, left voicemail)…" />
                <Button onClick={handleAddNote} disabled={!newNote.trim()} size="sm">Add</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isEdit && (
          <div className="flex justify-end gap-2 p-5 border-t">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!canManage}>Create ticket</Button>
          </div>
        )}
      </div>
    </div>
  );
}
