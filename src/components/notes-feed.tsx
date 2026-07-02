'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useOrderStore } from '@/lib/store';
import { OrderNote, ORDER_STATUS_CONFIG } from '@/lib/types';
import { MessageSquare, Search, Trash2, Plus, ShoppingBag, Send, RefreshCw, Inbox, ArrowLeft, Mail, MailOpen, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OrderDetailDialog } from './order-detail-dialog';
import { EbayNewMessageDialog } from './ebay-new-message-dialog';
import { TicketsPanel } from './tickets-panel';
import { ImageUpload } from './image-upload';
import { MESSAGE_IMAGE_BUCKET } from '@/lib/image-upload';
import { QuickActions } from './quick-actions';
import { Ticket as TicketIcon } from 'lucide-react';
import { toast } from 'sonner';

type Tab = 'team' | 'ebay' | 'tickets';

interface FeedEntry {
  note: OrderNote;
  orderId: string;
  salesRecordNumber: string;
  itemTitle: string;
}

interface EbayMessage {
  id: string;
  ebay_message_id: string | null;
  conversation_id: string | null;
  direction: 'sent' | 'received';
  order_id: string;
  item_id: string | null;
  buyer_username: string;
  sender_username: string | null;
  buyer_name: string | null;
  item_title: string | null;
  contact_reason: string | null;
  message_text: string;
  media_urls: string[] | null;
  conversation_type: string | null;   // FROM_MEMBERS (client) | FROM_EBAY (eBay)
  sent_by_id: string | null;
  sent_by_name: string | null;
  sent_at: string;
  status: string;
}

interface Conversation {
  key: string; // conversation_id (falls back to buyer_username + order_id)
  conversation_id: string | null;
  conversation_type: string;   // FROM_MEMBERS | FROM_EBAY
  buyer_username: string;
  buyer_name: string | null;
  order_id: string;
  item_id: string | null;      // eBay listing item id (referenceId)
  item_title: string | null;
  messages: EbayMessage[];
  lastAt: string;
  unreadCount: number;
}

const PLATFORM_LOGOS: Record<string, string> = {
  ebay:       '/ebay.png',
  amazon:     '/amazon.png',
  backmarket: '/backmarket.svg',
  onbuy:      '/onbuy.svg',
  temu:       '/temu.png',
};

const REASON_LABELS: Record<string, string> = {
  SHIPPING: 'Shipping update',
  ITEM: 'Item / variation',
  ORDER: 'Order update',
  DELAY: 'Dispatch delay',
  OTHER: 'Other',
  BUYER_MESSAGE: 'Buyer message',
};

export function NotesFeed() {
  const orders = useOrderStore((s) => s.orders);
  const currentUser = useOrderStore((s) => s.users.find((u) => u.id === s.currentUserId));
  const deleteOrderNote = useOrderStore((s) => s.deleteOrderNote);
  const addOrderNote = useOrderStore((s) => s.addOrderNote);
  const tickets = useOrderStore((s) => s.tickets);
  const activeTicketCount = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress' || t.status === 'waiting').length;

  const [tab, setTab] = useState<Tab>('team');
  const [search, setSearch] = useState('');
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNewEbayMsg, setShowNewEbayMsg] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [noteText, setNoteText] = useState('');

  // eBay messages
  const [ebayMessages, setEbayMessages] = useState<EbayMessage[]>([]);
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebaySyncing, setEbaySyncing] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [ebayFilter, setEbayFilter] = useState<'all' | 'unread' | 'client' | 'ebay'>('all');
  const [replyText, setReplyText] = useState('');
  const [replyImages, setReplyImages] = useState<string[]>([]);
  const [replySending, setReplySending] = useState(false);

  // Fast read of already-synced messages from our Supabase (no eBay calls).
  async function loadEbayMessages() {
    setEbayLoading(true);
    try {
      const res = await fetch('/api/ebay/messages/inbox');
      if (res.ok) {
        const data = await res.json() as { messages: EbayMessage[] };
        setEbayMessages(data.messages);
      }
    } catch {
      // silent
    } finally {
      setEbayLoading(false);
    }
  }

  // Pull only new messages from eBay into Supabase, then refresh from cache.
  async function syncEbayInbox() {
    setEbaySyncing(true);
    try {
      const res = await fetch('/api/ebay/messages/inbox', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { synced: number };
        if (data.synced > 0) toast.success(`${data.synced} new message${data.synced !== 1 ? 's' : ''} synced from eBay`);
        await loadEbayMessages();
      } else if (res.status === 401) {
        toast.error('eBay not connected');
      }
    } catch {
      toast.error('Failed to sync eBay inbox');
    } finally {
      setEbaySyncing(false);
    }
  }

  // Load the full message history for one conversation on demand.
  async function openConversation(convo: Conversation) {
    setActiveKey(convo.key);
    markRead(convo);
    if (!convo.conversation_id) return;
    try {
      const res = await fetch(`/api/ebay/messages/inbox?conversationId=${encodeURIComponent(convo.conversation_id)}&conversationType=${convo.conversation_type}`);
      if (res.ok) {
        const data = await res.json() as { messages: EbayMessage[] };
        // Merge the freshly-fetched thread into the cached list (dedup by id).
        // Keep a locally-read status so the re-fetch doesn't resurrect "unread".
        setEbayMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          for (const m of data.messages) {
            const existing = byId.get(m.id);
            byId.set(m.id, existing && existing.status === 'read' && m.status === 'unread' ? { ...m, status: 'read' } : m);
          }
          return [...byId.values()];
        });
      }
    } catch {
      // silent — the cached latest message is still shown
    }
  }

  useEffect(() => {
    if (tab === 'ebay') {
      /* eslint-disable react-hooks/set-state-in-effect */
      loadEbayMessages();
      syncEbayInbox();
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Our seller username = the sender that appears across the most conversations
  // (each buyer is unique to ~1 thread, so the seller is the clear mode).
  const sellerUsername = useMemo(() => {
    const perUser = new Map<string, Set<string>>();
    for (const m of ebayMessages) {
      if (!m.sender_username) continue;
      const convo = m.conversation_id ?? `${m.buyer_username}::${m.order_id}`;
      if (!perUser.has(m.sender_username)) perUser.set(m.sender_username, new Set());
      perUser.get(m.sender_username)!.add(convo);
    }
    let best: string | null = null; let bestN = 1;
    for (const [user, convos] of perUser) if (convos.size > bestN) { best = user; bestN = convos.size; }
    return best;
  }, [ebayMessages]);

  // Persist the detected seller username once, so feedback monitoring can run.
  useEffect(() => {
    if (!sellerUsername) return;
    fetch('/api/ebay/seller', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: sellerUsername }) }).catch(() => {});
  }, [sellerUsername]);

  // Is this message from us (right side) rather than the client (left side)?
  const isOurs = useCallback((m: EbayMessage, buyer: string) => {
    if (m.sent_by_name || m.sent_by_id) return true;            // sent via our app
    if (m.conversation_type === 'FROM_EBAY') return false;      // eBay system → inbound
    if (m.sender_username && sellerUsername) return m.sender_username === sellerUsername;
    if (m.sender_username && buyer) return m.sender_username !== buyer;
    return m.direction === 'sent';                              // fallback for un-backfilled rows
  }, [sellerUsername]);

  // Group messages into conversations (by eBay conversation, falling back to buyer+order)
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();
    for (const msg of ebayMessages) {
      const key = msg.conversation_id ?? `${msg.buyer_username}::${msg.order_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          conversation_id: msg.conversation_id,
          conversation_type: msg.conversation_type ?? 'FROM_MEMBERS',
          buyer_username: msg.buyer_username,
          buyer_name: msg.buyer_name,
          order_id: msg.order_id,
          item_id: msg.item_id,
          item_title: msg.item_title,
          messages: [],
          lastAt: msg.sent_at,
          unreadCount: 0,
        });
      }
      const convo = map.get(key)!;
      convo.messages.push(msg);
      if (!convo.item_id && msg.item_id) convo.item_id = msg.item_id;
      if (new Date(msg.sent_at) > new Date(convo.lastAt)) convo.lastAt = msg.sent_at;
      if (!isOurs(msg, msg.buyer_username) && msg.status === 'unread') convo.unreadCount++;
    }
    return [...map.values()]
      .map(c => ({ ...c, messages: c.messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at)) }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [ebayMessages, isOurs]);

  const activeConvo = useMemo(
    () => conversations.find((c) => c.key === activeKey) ?? null,
    [conversations, activeKey]
  );

  // Related listing (image/title/price) for the open conversation, fetched on demand.
  const [listing, setListing] = useState<{ image_url: string | null; title: string | null; price: number | null; currency: string | null; web_url: string | null } | null>(null);
  const activeItemId = activeConvo?.item_id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListing(null);
    if (!activeItemId || !/^\d+$/.test(activeItemId)) return;
    let alive = true;
    fetch(`/api/ebay/listing?itemId=${activeItemId}`)
      .then((r) => r.json())
      .then((d) => { if (alive && d.listing) setListing(d.listing); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeItemId]);

  // Related order in our own system (matched by listing item id + buyer, else buyer)
  const relatedOrder = useMemo(() => {
    if (!activeConvo) return null;
    return orders.find((o) => !o.deletedAt && o.itemNumber && o.itemNumber === activeConvo.item_id && o.buyerUsername === activeConvo.buyer_username)
      ?? orders.find((o) => !o.deletedAt && o.buyerUsername === activeConvo.buyer_username) ?? null;
  }, [activeConvo, orders]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);

  async function setConversationRead(convo: Conversation, read: boolean) {
    const ids = convo.messages.filter(m => m.direction === 'received').map(m => m.id);
    if (ids.length === 0) return;
    // Skip the no-op case (marking read when nothing is unread)
    if (read && !convo.messages.some(m => m.direction === 'received' && m.status === 'unread')) return;
    setEbayMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, status: read ? 'read' : 'unread' } : m));
    await fetch('/api/ebay/messages/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids, read,
        conversationIds: convo.conversation_id ? [convo.conversation_id] : undefined,
        conversationType: convo.conversation_type,
      }),
    });
  }
  const markRead = (convo: Conversation) => setConversationRead(convo, true);
  const markUnread = (convo: Conversation) => setConversationRead(convo, false);

  async function handleReply() {
    if (!activeConvo || (!replyText.trim() && replyImages.length === 0)) return;
    setReplySending(true);
    try {
      const lastMsg = activeConvo.messages[activeConvo.messages.length - 1];
      const res = await fetch('/api/ebay/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeConvo.order_id,
          itemId: lastMsg?.item_id ?? activeConvo.order_id,
          conversationId: activeConvo.conversation_id ?? undefined,
          recipientUsername: activeConvo.buyer_username,
          buyerName: activeConvo.buyer_name,
          itemTitle: activeConvo.item_title,
          contactReason: 'ORDER',
          text: replyText,
          imageUrls: replyImages,
          sentById: currentUser?.id,
          sentByName: currentUser?.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        toast.error(`Send failed: ${err.message || 'Unknown error'}`);
        return;
      }
      toast.success('Reply sent');
      setReplyText('');
      setReplyImages([]);
      await loadEbayMessages();
    } catch {
      toast.error('Failed to send reply');
    } finally {
      setReplySending(false);
    }
  }

  // ── Team notes ──
  const feed = useMemo(() => {
    const entries: FeedEntry[] = [];
    for (const order of orders) {
      for (const note of order.notes ?? []) {
        entries.push({ note, orderId: order.id, salesRecordNumber: order.salesRecordNumber, itemTitle: order.itemTitle });
      }
    }
    return entries.sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  }, [orders]);

  const filteredNotes = useMemo(() => {
    if (!search.trim()) return feed;
    const q = search.toLowerCase();
    return feed.filter(
      (e) => e.note.text.toLowerCase().includes(q) || e.note.authorName.toLowerCase().includes(q) ||
             e.salesRecordNumber.toLowerCase().includes(q) || e.itemTitle.toLowerCase().includes(q)
    );
  }, [feed, search]);

  const filteredEbay = useMemo(() => {
    if (!search.trim()) return ebayMessages;
    const q = search.toLowerCase();
    return ebayMessages.filter(
      (m) => m.buyer_username.toLowerCase().includes(q) || (m.buyer_name ?? '').toLowerCase().includes(q) ||
             m.order_id.toLowerCase().includes(q) || m.message_text.toLowerCase().includes(q)
    );
  }, [ebayMessages, search]);

  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) : null;

  const handleDeleteNote = (orderId: string, noteId: string) => {
    deleteOrderNote(orderId, noteId);
    toast.success('Note deleted');
  };

  const handleAddNote = () => {
    if (!selectedOrderId) { toast.error('Please select an order'); return; }
    if (!noteText.trim()) { toast.error('Please enter a note'); return; }
    if (!currentUser) { toast.error('Please sign in to add notes'); return; }
    addOrderNote(selectedOrderId, { text: noteText.trim(), authorId: currentUser.id, authorName: currentUser.name });
    toast.success('Note added');
    setNoteText('');
    setSelectedOrderId('');
    setShowAddForm(false);
  };

  return (
    <div className={tab === 'ebay' ? 'px-3 py-3 max-w-none space-y-3' : 'p-6 max-w-3xl mx-auto space-y-4'}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-blue-500" />
            Messages
          </h2>
          <p className="text-slate-500 text-sm mt-1">Team notes and eBay buyer messages</p>
        </div>
        {tab === 'ebay' && (
          <Button onClick={() => setShowNewEbayMsg(true)} className="bg-amber-600 hover:bg-amber-700 text-white">
            <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-4 w-auto object-contain mr-1.5 brightness-0 invert" />
            New eBay Message
          </Button>
        )}
        {tab === 'team' && (
          <Button onClick={() => setShowAddForm(!showAddForm)} variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Add Note
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg border overflow-hidden text-sm w-fit">
        <button
          onClick={() => { setTab('team'); setSearch(''); }}
          className={`px-5 py-2 font-medium transition-colors ${tab === 'team' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          Team Notes {feed.length > 0 && <span className="ml-1 text-xs opacity-75">({feed.length})</span>}
        </button>
        <button
          onClick={() => { setTab('ebay'); setSearch(''); setActiveKey(null); }}
          className={`px-5 py-2 font-medium transition-colors flex items-center gap-1.5 ${tab === 'ebay' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-4 w-auto object-contain" />
          Inbox
          {unreadTotal > 0 && <span className="ml-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unreadTotal}</span>}
        </button>
        <button
          onClick={() => { setTab('tickets'); setSearch(''); setActiveKey(null); }}
          className={`px-5 py-2 font-medium transition-colors flex items-center gap-1.5 ${tab === 'tickets' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          <TicketIcon className="h-4 w-4" />
          Tickets
          {activeTicketCount > 0 && <span className="ml-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{activeTicketCount}</span>}
        </button>
      </div>

      {/* Search — the tickets tab has its own; on eBay it filters the conversation list */}
      {tab !== 'tickets' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder={tab === 'team' ? 'Search notes, orders, authors...' : 'Search buyer, order, message...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {/* ── TEAM NOTES TAB ── */}
      {tab === 'team' && (
        <>
          {showAddForm && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Select Order</label>
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Choose an order...</option>
                  {orders
                    .filter(o => o.postToAddress1 || o.postToPostcode)
                    .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
                    .slice(0, 50)
                    .map(o => (
                      <option key={o.id} value={o.id}>
                        #{o.salesRecordNumber} — {o.itemTitle.slice(0, 60)}{o.itemTitle.length > 60 ? '...' : ''}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Note</label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter your note..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddNote} size="sm">Add Note</Button>
                <Button onClick={() => setShowAddForm(false)} variant="outline" size="sm">Cancel</Button>
              </div>
            </div>
          )}

          {filteredNotes.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 text-slate-200" />
              <p className="font-medium">{search ? 'No notes match your search' : 'No notes yet'}</p>
              <p className="text-sm mt-1">Open any order and add a note for the team</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredNotes.map((entry) => (
                <div key={entry.note.id} className="group bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => setOpenOrderId(entry.orderId)} className="text-xs font-mono text-blue-600 hover:underline mb-1 block">
                        #{entry.salesRecordNumber} — {entry.itemTitle.length > 60 ? entry.itemTitle.slice(0, 60) + '…' : entry.itemTitle}
                      </button>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{entry.note.text}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                          {entry.note.authorName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-medium text-slate-600">{entry.note.authorName}</span>
                        <span className="text-xs text-slate-400">
                          {new Date(entry.note.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    {(currentUser?.id === entry.note.authorId || currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                      <button onClick={() => handleDeleteNote(entry.orderId, entry.note.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── EBAY INBOX TAB — Gmail-style two panes ── */}
      {tab === 'ebay' && (
        <div className="flex gap-3 h-[calc(100vh-12rem)] min-h-[420px]">
          {/* LEFT PANE — conversation list (full width on mobile until one is opened) */}
          <div className={`${activeConvo ? 'hidden md:flex' : 'flex'} w-full md:w-[320px] shrink-0 flex-col border border-slate-200 rounded-xl overflow-hidden bg-white`}>
            {(() => {
              const filtered = conversations.filter((c) => {
                if (search && !(c.buyer_username.toLowerCase().includes(search.toLowerCase()) || c.order_id.toLowerCase().includes(search.toLowerCase()) || (c.buyer_name ?? '').toLowerCase().includes(search.toLowerCase()))) return false;
                if (ebayFilter === 'unread') return c.unreadCount > 0;
                if (ebayFilter === 'client') return c.conversation_type !== 'FROM_EBAY';
                if (ebayFilter === 'ebay') return c.conversation_type === 'FROM_EBAY';
                return true;
              });
              const FILTERS: { key: typeof ebayFilter; label: string }[] = [
                { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' },
                { key: 'client', label: 'Client' }, { key: 'ebay', label: 'eBay' },
              ];
              return (
                <>
                  <div className="border-b shrink-0">
                    <div className="flex items-center justify-between px-3 py-2">
                      <p className="text-xs text-slate-400">{filtered.length} of {conversations.length}</p>
                      <button onClick={syncEbayInbox} disabled={ebaySyncing} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 disabled:opacity-50">
                        <RefreshCw className={`h-3 w-3 ${ebaySyncing ? 'animate-spin' : ''}`} /> {ebaySyncing ? 'Syncing…' : 'Sync'}
                      </button>
                    </div>
                    <div className="flex gap-1 px-2 pb-2">
                      {FILTERS.map((f) => (
                        <button key={f.key} onClick={() => setEbayFilter(f.key)}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${ebayFilter === f.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                          {f.label}{f.key === 'unread' && unreadTotal > 0 ? ` ${unreadTotal}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {ebayLoading || (ebaySyncing && ebayMessages.length === 0) ? (
                      <div className="text-center py-16 text-slate-400">
                        <RefreshCw className="h-8 w-8 mx-auto mb-3 animate-spin text-slate-200" />
                        <p className="text-sm">Syncing…</p>
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="text-center py-16 px-4 text-slate-400">
                        <Inbox className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                        <p className="font-medium">{conversations.length === 0 ? 'No messages yet' : 'Nothing matches'}</p>
                        {conversations.length === 0 && <p className="text-sm mt-1">Click &quot;Sync&quot; to fetch incoming messages.</p>}
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {filtered.map((convo) => {
                          const last = convo.messages[convo.messages.length - 1];
                          const isActive = convo.key === activeKey;
                          const isEbay = convo.conversation_type === 'FROM_EBAY';
                          const accent = isActive ? (isEbay ? 'bg-blue-50 border-blue-500' : 'bg-amber-50 border-amber-500')
                            : convo.unreadCount > 0 ? (isEbay ? 'bg-blue-50/40 border-transparent hover:bg-slate-50' : 'bg-amber-50/40 border-transparent hover:bg-slate-50')
                            : 'border-transparent hover:bg-slate-50';
                          return (
                            <div key={convo.key} onClick={() => openConversation(convo)}
                              className={`group cursor-pointer px-3 py-2.5 transition-colors border-l-2 ${accent}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold shrink-0 ${isEbay ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{isEbay ? 'eBay' : 'Client'}</span>
                                  <span className={`text-sm font-mono truncate ${convo.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{convo.buyer_username}</span>
                                </span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <button onClick={(e) => { e.stopPropagation(); convo.unreadCount > 0 ? markRead(convo) : markUnread(convo); }}
                                    title={convo.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
                                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700">
                                    {convo.unreadCount > 0 ? <MailOpen className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                                  </button>
                                  <span className="text-[10px] text-slate-400">{new Date(convo.lastAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">Order #{convo.order_id}{convo.item_title ? ` · ${convo.item_title.slice(0, 40)}` : ''}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {convo.unreadCount > 0 && <span className="bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 leading-tight py-0.5 shrink-0">{convo.unreadCount}</span>}
                                <p className={`text-xs truncate ${convo.unreadCount > 0 ? 'text-slate-700' : 'text-slate-500'}`}>
                                  {last && isOurs(last, convo.buyer_username) ? '↑ ' : '↓ '}{last?.message_text}{(last?.media_urls?.length ?? 0) > 0 ? ' 📎' : ''}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

          {/* RIGHT PANE — reading pane */}
          <div className={`${activeConvo ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col border border-slate-200 rounded-xl overflow-hidden bg-white`}>
            {activeConvo ? (
              <>
                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
                  <button onClick={() => setActiveKey(null)} className="md:hidden text-slate-400 hover:text-slate-700 shrink-0">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-5 w-auto object-contain shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-800 font-mono text-sm truncate">{activeConvo.buyer_username}</p>
                    <p className="text-xs text-slate-400 truncate">{activeConvo.buyer_name ? `${activeConvo.buyer_name} · ` : ''}Order #{activeConvo.order_id}{activeConvo.item_title ? ` · ${activeConvo.item_title}` : ''}</p>
                  </div>
                  <button
                    onClick={() => activeConvo.unreadCount > 0 ? markRead(activeConvo) : markUnread(activeConvo)}
                    title={activeConvo.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
                    className="shrink-0 text-slate-400 hover:text-slate-700 flex items-center gap-1 text-xs"
                  >
                    {activeConvo.unreadCount > 0 ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    <span className="hidden sm:inline">{activeConvo.unreadCount > 0 ? 'Mark read' : 'Mark unread'}</span>
                  </button>
                </div>

                {/* Related listing + order context bar (like eBay's website) */}
                {(listing || relatedOrder || activeConvo.item_title) && (
                  <div className="flex items-center gap-3 px-4 py-2 border-b bg-slate-50 shrink-0">
                    {listing?.image_url ? (
                      <a href={listing.web_url ?? '#'} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={listing.image_url} alt="listing" className="h-12 w-12 rounded-md object-cover border border-slate-200" />
                      </a>
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                        <ShoppingBag className="h-5 w-5 text-slate-300" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700 truncate">{listing?.title || activeConvo.item_title || 'Listing'}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {listing?.price != null && <span className="text-xs text-slate-500">{listing.currency === 'GBP' ? '£' : ''}{Number(listing.price).toFixed(2)}</span>}
                        {relatedOrder ? (
                          <button onClick={() => setOpenOrderId(relatedOrder.id)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                            Order #{relatedOrder.salesRecordNumber}
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${ORDER_STATUS_CONFIG[relatedOrder.status]?.color ?? ''}`}>{ORDER_STATUS_CONFIG[relatedOrder.status]?.label ?? relatedOrder.status}</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">No matching order</span>
                        )}
                        {listing?.web_url && (
                          <a href={listing.web_url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-0.5">
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Messages — ours on the right (blue), client on the left (grey) */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {activeConvo.messages.map((msg) => {
                    const ours = isOurs(msg, activeConvo.buyer_username);
                    const failed = msg.status === 'failed';
                    return (
                    <div key={msg.id} className={`flex ${ours ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        failed ? 'bg-red-100 text-red-800 rounded-br-sm'
                        : ours ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                      }`}>
                        {msg.message_text && <p className="whitespace-pre-wrap leading-relaxed">{msg.message_text}</p>}
                        {(msg.media_urls?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {msg.media_urls!.map((url) => (
                              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt="attachment" className="h-24 w-24 object-cover rounded-lg border border-black/10" />
                              </a>
                            ))}
                          </div>
                        )}
                        <p className={`text-[10px] mt-1 ${ours ? 'text-blue-200' : 'text-slate-400'}`}>
                          {ours ? (msg.sent_by_name ?? 'You') : msg.buyer_username}
                          {' · '}
                          {new Date(msg.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {failed && ' · Failed'}
                        </p>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Quick actions — raise a ticket for a customer request in one tap */}
                {(() => {
                  const matched = orders.find((o) => !o.deletedAt && o.buyerUsername === activeConvo.buyer_username);
                  const lastReceived = [...activeConvo.messages].reverse().find((m) => m.direction === 'received');
                  return (
                    <div className="border-t px-3 py-2 shrink-0 bg-slate-50/60">
                      <QuickActions context={{
                        buyerUsername: activeConvo.buyer_username,
                        buyerName: activeConvo.buyer_name ?? matched?.buyerName ?? undefined,
                        itemTitle: activeConvo.item_title ?? matched?.itemTitle ?? undefined,
                        ebayConversationId: activeConvo.conversation_id ?? undefined,
                        orderId: matched?.id,
                        salesRecordNumber: matched?.salesRecordNumber,
                        orderNumber: matched?.orderNumber,
                        contactPhone: matched?.postToPhone,
                        contactEmail: matched?.buyerEmail,
                        note: lastReceived?.message_text,
                      }} />
                    </div>
                  );
                })()}

                {/* Reply bar — inline: attach · type · send */}
                <div className="border-t p-2 shrink-0 space-y-2">
                  {replyImages.length > 0 && (
                    <ImageUpload bucket={MESSAGE_IMAGE_BUCKET} recordId={activeConvo.conversation_id ?? activeConvo.order_id} images={replyImages} onChange={setReplyImages} maxFiles={5} compact />
                  )}
                  <div className="flex items-end gap-2">
                    {replyImages.length === 0 && (
                      <ImageUpload bucket={MESSAGE_IMAGE_BUCKET} recordId={activeConvo.conversation_id ?? activeConvo.order_id} images={replyImages} onChange={setReplyImages} maxFiles={5} compact />
                    )}
                    <textarea
                      className="flex-1 border rounded-xl px-3 py-2 text-sm min-h-[40px] max-h-32 resize-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      placeholder="Type your reply…"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                      rows={1}
                      maxLength={2000}
                    />
                    <Button
                      onClick={handleReply}
                      disabled={(!replyText.trim() && replyImages.length === 0) || replySending}
                      className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                      size="sm"
                    >
                      <Send className="h-3.5 w-3.5 sm:mr-1.5" />
                      <span className="hidden sm:inline">{replySending ? 'Sending…' : 'Reply'}</span>
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                <MessageSquare className="h-14 w-14 mb-3" />
                <p className="text-sm text-slate-400">Select a conversation to read it</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TICKETS TAB ── */}
      {tab === 'tickets' && <TicketsPanel />}

      {openOrder && <OrderDetailDialog order={openOrder} onClose={() => setOpenOrderId(null)} />}
      {showNewEbayMsg && <EbayNewMessageDialog onClose={() => { setShowNewEbayMsg(false); loadEbayMessages(); }} />}
    </div>
  );
}
