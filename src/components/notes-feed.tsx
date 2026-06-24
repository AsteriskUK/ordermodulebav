'use client';

import { useMemo, useState, useEffect } from 'react';
import { useOrderStore } from '@/lib/store';
import { OrderNote } from '@/lib/types';
import { MessageSquare, Search, Trash2, Plus, ShoppingBag, Send, RefreshCw, Inbox, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OrderDetailDialog } from './order-detail-dialog';
import { EbayNewMessageDialog } from './ebay-new-message-dialog';
import { toast } from 'sonner';

type Tab = 'team' | 'ebay';

interface FeedEntry {
  note: OrderNote;
  orderId: string;
  salesRecordNumber: string;
  itemTitle: string;
}

interface EbayMessage {
  id: string;
  ebay_message_id: string | null;
  direction: 'sent' | 'received';
  order_id: string;
  item_id: string | null;
  buyer_username: string;
  buyer_name: string | null;
  item_title: string | null;
  contact_reason: string | null;
  message_text: string;
  sent_by_name: string | null;
  sent_at: string;
  status: string;
}

interface Conversation {
  key: string; // buyer_username + order_id
  buyer_username: string;
  buyer_name: string | null;
  order_id: string;
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
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  async function loadEbayMessages() {
    setEbayLoading(true);
    try {
      const res = await fetch('/api/ebay/messages/inbox');
      if (res.ok) {
        const data = await res.json() as { messages: EbayMessage[]; synced: number };
        setEbayMessages(data.messages);
        if (data.synced > 0) toast.success(`${data.synced} new message${data.synced !== 1 ? 's' : ''} synced from eBay`);
      }
    } catch {
      // silent
    } finally {
      setEbayLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'ebay') loadEbayMessages();
  }, [tab]);

  // Group messages into conversations
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();
    for (const msg of ebayMessages) {
      const key = `${msg.buyer_username}::${msg.order_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          buyer_username: msg.buyer_username,
          buyer_name: msg.buyer_name,
          order_id: msg.order_id,
          item_title: msg.item_title,
          messages: [],
          lastAt: msg.sent_at,
          unreadCount: 0,
        });
      }
      const convo = map.get(key)!;
      convo.messages.push(msg);
      if (new Date(msg.sent_at) > new Date(convo.lastAt)) convo.lastAt = msg.sent_at;
      if (msg.direction === 'received' && msg.status === 'unread') convo.unreadCount++;
    }
    return [...map.values()]
      .map(c => ({ ...c, messages: c.messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at)) }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }, [ebayMessages]);

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);

  async function markRead(convo: Conversation) {
    const unreadIds = convo.messages.filter(m => m.direction === 'received' && m.status === 'unread').map(m => m.id);
    if (unreadIds.length === 0) return;
    await fetch('/api/ebay/messages/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: unreadIds }),
    });
    setEbayMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, status: 'read' } : m));
  }

  async function handleReply() {
    if (!activeConvo || !replyText.trim()) return;
    setReplySending(true);
    try {
      const lastMsg = activeConvo.messages[activeConvo.messages.length - 1];
      const res = await fetch('/api/ebay/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: activeConvo.order_id,
          itemId: lastMsg?.item_id ?? activeConvo.order_id,
          recipientUsername: activeConvo.buyer_username,
          buyerName: activeConvo.buyer_name,
          itemTitle: activeConvo.item_title,
          contactReason: 'ORDER',
          text: replyText,
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
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-blue-500" />
            Messages
          </h2>
          <p className="text-slate-500 text-sm mt-1">Team notes and eBay buyer messages</p>
        </div>
        {tab === 'ebay' && !activeConvo && (
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
          onClick={() => { setTab('ebay'); setSearch(''); setActiveConvo(null); }}
          className={`px-5 py-2 font-medium transition-colors flex items-center gap-1.5 ${tab === 'ebay' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-4 w-auto object-contain" />
          Inbox
          {unreadTotal > 0 && <span className="ml-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unreadTotal}</span>}
        </button>
      </div>

      {/* Search — hidden when inside a conversation thread */}
      {!(tab === 'ebay' && activeConvo) && (
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

      {/* ── EBAY INBOX TAB ── */}
      {tab === 'ebay' && (
        <>
          {/* Conversation thread view */}
          {activeConvo ? (
            <div className="flex flex-col gap-3">
              {/* Thread header */}
              <div className="flex items-center gap-3 pb-2 border-b">
                <button onClick={() => setActiveConvo(null)} className="text-slate-400 hover:text-slate-700">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-5 w-auto object-contain shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 font-mono text-sm">{activeConvo.buyer_username}</p>
                  {activeConvo.buyer_name && <p className="text-xs text-slate-400">{activeConvo.buyer_name}</p>}
                  <p className="text-xs text-slate-400 truncate">Order #{activeConvo.order_id}{activeConvo.item_title ? ` · ${activeConvo.item_title}` : ''}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {activeConvo.messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.direction === 'sent'
                        ? msg.status === 'failed'
                          ? 'bg-red-100 text-red-800 rounded-br-sm'
                          : 'bg-amber-600 text-white rounded-br-sm'
                        : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.message_text}</p>
                      <p className={`text-[10px] mt-1 ${msg.direction === 'sent' ? 'text-amber-200' : 'text-slate-400'}`}>
                        {msg.direction === 'sent' ? (msg.sent_by_name ?? 'You') : msg.buyer_username}
                        {' · '}
                        {new Date(msg.sent_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {msg.status === 'failed' && ' · Failed'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply box */}
              <div className="border-t pt-3">
                <textarea
                  className="w-full border rounded-xl p-3 text-sm min-h-[80px] resize-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  placeholder="Type your reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  maxLength={2000}
                />
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-slate-400">{replyText.length}/2000</span>
                  <Button
                    onClick={handleReply}
                    disabled={!replyText.trim() || replySending}
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    size="sm"
                  >
                    <Send className="h-3.5 w-3.5 mr-1.5" />
                    {replySending ? 'Sending…' : 'Reply'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Conversations list */
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p>
                <button onClick={loadEbayMessages} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <RefreshCw className={`h-3 w-3 ${ebayLoading ? 'animate-spin' : ''}`} /> Sync inbox
                </button>
              </div>

              {ebayLoading ? (
                <div className="text-center py-16 text-slate-400">
                  <RefreshCw className="h-8 w-8 mx-auto mb-3 animate-spin text-slate-200" />
                  <p className="text-sm">Syncing messages from eBay...</p>
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Inbox className="h-12 w-12 mx-auto mb-3 text-slate-200" />
                  <p className="font-medium">No messages yet</p>
                  <p className="text-sm mt-1">Click "Sync inbox" to fetch incoming messages, or send a new message to a buyer</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {conversations
                    .filter(c => !search || c.buyer_username.toLowerCase().includes(search.toLowerCase()) || c.order_id.toLowerCase().includes(search.toLowerCase()) || (c.buyer_name ?? '').toLowerCase().includes(search.toLowerCase()))
                    .map((convo) => {
                      const last = convo.messages[convo.messages.length - 1];
                      return (
                        <button
                          key={convo.key}
                          onClick={() => { setActiveConvo(convo); markRead(convo); }}
                          className={`w-full text-left border rounded-xl px-4 py-3 hover:border-amber-300 hover:shadow-sm transition-all ${convo.unreadCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-4 w-auto object-contain shrink-0" />
                                <span className={`text-sm font-mono ${convo.unreadCount > 0 ? 'font-bold text-amber-800' : 'font-medium text-slate-700'}`}>
                                  {convo.buyer_username}
                                </span>
                                {convo.buyer_name && <span className="text-xs text-slate-400">({convo.buyer_name})</span>}
                                {convo.unreadCount > 0 && (
                                  <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                                    {convo.unreadCount}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">Order #{convo.order_id}{convo.item_title ? ` · ${convo.item_title.slice(0, 50)}` : ''}</p>
                              <p className="text-sm text-slate-600 mt-1 truncate">
                                {last?.direction === 'sent' ? '↑ You: ' : '↓ '}{last?.message_text}
                              </p>
                            </div>
                            <span className="text-xs text-slate-400 shrink-0">
                              {new Date(convo.lastAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {openOrder && <OrderDetailDialog order={openOrder} onClose={() => setOpenOrderId(null)} />}
      {showNewEbayMsg && <EbayNewMessageDialog onClose={() => { setShowNewEbayMsg(false); loadEbayMessages(); }} />}
    </div>
  );
}
