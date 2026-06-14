'use client';

import { useMemo, useState } from 'react';
import { useOrderStore } from '@/lib/store';
import { OrderNote } from '@/lib/types';
import { MessageSquare, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { OrderDetailDialog } from './order-detail-dialog';
import { toast } from 'sonner';

interface FeedEntry {
  note: OrderNote;
  orderId: string;
  salesRecordNumber: string;
  itemTitle: string;
}

export function NotesFeed() {
  const orders = useOrderStore((s) => s.orders);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const deleteOrderNote = useOrderStore((s) => s.deleteOrderNote);
  const [search, setSearch] = useState('');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const feed = useMemo(() => {
    const entries: FeedEntry[] = [];
    for (const order of orders) {
      for (const note of order.notes ?? []) {
        entries.push({
          note,
          orderId: order.id,
          salesRecordNumber: order.salesRecordNumber,
          itemTitle: order.itemTitle,
        });
      }
    }
    return entries.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  }, [orders]);

  const filtered = useMemo(() => {
    if (!search.trim()) return feed;
    const q = search.toLowerCase();
    return feed.filter(
      (e) =>
        e.note.text.toLowerCase().includes(q) ||
        e.note.authorName.toLowerCase().includes(q) ||
        e.salesRecordNumber.toLowerCase().includes(q) ||
        e.itemTitle.toLowerCase().includes(q)
    );
  }, [feed, search]);

  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) : null;

  const handleDelete = (orderId: string, noteId: string) => {
    deleteOrderNote(orderId, noteId);
    toast.success('Note deleted');
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-blue-500" />
          Team Notes
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          All order notes across the warehouse — {feed.length} total
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Search notes, orders, authors..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <MessageSquare className="h-12 w-12 mx-auto mb-3 text-slate-200" />
          <p className="font-medium">{search ? 'No notes match your search' : 'No notes yet'}</p>
          <p className="text-sm mt-1">Open any order and add a note for the team</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <div
              key={entry.note.id}
              className="group bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Order reference */}
                  <button
                    onClick={() => setOpenOrderId(entry.orderId)}
                    className="text-xs font-mono text-blue-600 hover:underline mb-1 block"
                  >
                    #{entry.salesRecordNumber} — {entry.itemTitle.length > 60 ? entry.itemTitle.slice(0, 60) + '…' : entry.itemTitle}
                  </button>
                  {/* Note body */}
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{entry.note.text}</p>
                  {/* Meta */}
                  <div className="flex items-center gap-2 mt-2">
                    <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {entry.note.authorName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-xs font-medium text-slate-600">{entry.note.authorName}</span>
                    <span className="text-xs text-slate-400">
                      {new Date(entry.note.createdAt).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                {(currentUser?.id === entry.note.authorId ||
                  currentUser?.role === 'admin' ||
                  currentUser?.role === 'manager') && (
                  <button
                    onClick={() => handleDelete(entry.orderId, entry.note.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 shrink-0"
                    title="Delete note"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {openOrder && (
        <OrderDetailDialog order={openOrder} onClose={() => setOpenOrderId(null)} />
      )}
    </div>
  );
}
