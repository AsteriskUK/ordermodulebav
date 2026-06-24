'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, ShoppingBag, Search, User } from 'lucide-react';
import { toast } from 'sonner';
import { useOrderStore } from '@/lib/store';

interface Props {
  onClose: () => void;
}

const REASONS = [
  { value: 'SHIPPING', label: 'Shipping update' },
  { value: 'ITEM', label: 'Item / variation query' },
  { value: 'ORDER', label: 'General order update' },
  { value: 'DELAY', label: 'Dispatch delay' },
  { value: 'OTHER', label: 'Other' },
];

interface BuyerSuggestion {
  username: string;
  name: string;
  orderId: string;
  itemId: string;
  itemTitle: string;
  source: 'order' | 'message_history';
}

export function EbayNewMessageDialog({ onClose }: Props) {
  const orders = useOrderStore((s) => s.orders);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));

  const [search, setSearch] = useState('');
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerSuggestion | null>(null);
  const [manualUsername, setManualUsername] = useState('');
  const [manualItemId, setManualItemId] = useState('');
  const [manualOrderId, setManualOrderId] = useState('');
  const [reason, setReason] = useState('ORDER');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'search' | 'manual'>('search');

  // Build buyer list from eBay orders in store
  const knownBuyers = useMemo<BuyerSuggestion[]>(() => {
    const seen = new Set<string>();
    const results: BuyerSuggestion[] = [];
    // Most recent first
    const ebayOrders = [...orders]
      .filter((o) => o.buyerUsername)
      .sort((a, b) => new Date(b.saleDate || 0).getTime() - new Date(a.saleDate || 0).getTime());

    for (const o of ebayOrders) {
      if (!o.buyerUsername || seen.has(o.buyerUsername)) continue;
      seen.add(o.buyerUsername);
      results.push({
        username: o.buyerUsername,
        name: o.buyerName || o.postToName,
        orderId: o.salesRecordNumber,
        itemId: o.itemNumber,
        itemTitle: o.itemTitle,
        source: 'order',
      });
    }
    return results;
  }, [orders]);

  const filtered = useMemo(() => {
    if (!search.trim()) return knownBuyers.slice(0, 8);
    const q = search.toLowerCase();
    return knownBuyers
      .filter((b) => b.username.toLowerCase().includes(q) || b.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [knownBuyers, search]);

  const recipient = mode === 'search' ? selectedBuyer : null;
  const effectiveUsername = recipient?.username || manualUsername.trim();
  const effectiveItemId = recipient?.itemId || manualItemId.trim();
  const effectiveOrderId = recipient?.orderId || manualOrderId.trim();
  const canSend = !!effectiveUsername && !!effectiveItemId && !!text.trim();

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await fetch('/api/ebay/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: effectiveOrderId || effectiveItemId,
          itemId: effectiveItemId,
          recipientUsername: effectiveUsername,
          buyerName: recipient?.name,
          itemTitle: recipient?.itemTitle,
          contactReason: reason,
          text,
          sentById: currentUser?.id,
          sentByName: currentUser?.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Send failed: ${err.message || 'Unknown error'}`);
        return;
      }
      toast.success(`Message sent to ${effectiveUsername} via eBay inbox`);
      onClose();
    } catch {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  }

  const showCompose = mode === 'manual' || !!selectedBuyer;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-amber-600" />
            New eBay Message
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pr-1 flex-1">
          {/* Mode toggle */}
          <div className="flex rounded-lg border overflow-hidden text-sm shrink-0">
            <button
              onClick={() => { setMode('search'); setSelectedBuyer(null); setSearch(''); }}
              className={`flex-1 py-2 font-medium transition-colors ${mode === 'search' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Search buyers
            </button>
            <button
              onClick={() => { setMode('manual'); setSelectedBuyer(null); }}
              className={`flex-1 py-2 font-medium transition-colors ${mode === 'manual' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Enter manually
            </button>
          </div>

          {/* Search mode */}
          {mode === 'search' && !selectedBuyer && (
            <div className="space-y-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by eBay username or name..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="border rounded-lg divide-y max-h-56 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No buyers found — try manual entry</p>
                ) : filtered.map((b) => (
                  <button
                    key={b.username}
                    onClick={() => { setSelectedBuyer(b); setSearch(''); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-amber-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-800">{b.username}</span>
                      {b.name && <span className="text-xs text-slate-400">({b.name})</span>}
                    </div>
                    <p className="text-xs text-slate-400 pl-5 mt-0.5 truncate">{b.itemTitle} — Order #{b.orderId}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected buyer pill */}
          {mode === 'search' && selectedBuyer && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shrink-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-800 font-mono">{selectedBuyer.username}</p>
                <p className="text-xs text-slate-500 truncate">{selectedBuyer.name} · Order #{selectedBuyer.orderId}</p>
              </div>
              <button onClick={() => { setSelectedBuyer(null); }} className="text-xs text-amber-600 hover:text-amber-800 underline ml-3 shrink-0">Change</button>
            </div>
          )}

          {/* Manual fields */}
          {mode === 'manual' && (
            <div className="space-y-3 shrink-0">
              <p className="text-xs text-slate-500">eBay requires an item ID that the buyer has interacted with (purchased, bid on, or watched).</p>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">eBay Username *</label>
                <Input placeholder="e.g. buyer123" value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">eBay Item ID * <span className="text-slate-400">(from your listing)</span></label>
                <Input placeholder="e.g. 123456789012" value={manualItemId} onChange={(e) => setManualItemId(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Order ID <span className="text-slate-400">(optional)</span></label>
                <Input placeholder="e.g. 21-12345-67890" value={manualOrderId} onChange={(e) => setManualOrderId(e.target.value)} />
              </div>
            </div>
          )}

          {/* Compose area — only shown once buyer is chosen */}
          {showCompose && (
            <>
              <div className="flex items-center gap-3 shrink-0">
                <label className="text-sm text-slate-600 w-16 shrink-0">Reason:</label>
                <Select value={reason} onValueChange={(v) => v && setReason(v)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="shrink-0">
                <textarea
                  className="w-full border rounded-lg p-3 text-sm min-h-[110px] resize-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="Type your message..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  autoFocus
                />
                <p className="text-xs text-slate-400 text-right mt-0.5">{text.length}/2000</p>
              </div>
            </>
          )}
        </div>

        {/* Footer always at bottom */}
        <div className="flex gap-2 justify-end pt-3 border-t mt-2 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={!canSend || sending}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            <Send className="h-4 w-4 mr-1.5" />
            {sending ? 'Sending…' : 'Send to eBay Inbox'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
