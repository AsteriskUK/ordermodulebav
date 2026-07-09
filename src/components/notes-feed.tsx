'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useOrderStore } from '@/lib/store';
import { OrderNote, ORDER_STATUS_CONFIG } from '@/lib/types';
import { can } from '@/lib/access';
import { MessageSquare, Search, Trash2, Plus, ShoppingBag, Send, RefreshCw, Inbox, ArrowLeft, Mail, MailOpen, ExternalLink, FileText, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { OrderDetailDialog } from './order-detail-dialog';
import { EbayNewMessageDialog } from './ebay-new-message-dialog';
import { TicketsPanel } from './tickets-panel';
import { ImageUpload } from './image-upload';
import { MESSAGE_IMAGE_BUCKET } from '@/lib/image-upload';
import { htmlEmailToText } from '@/lib/html-text';
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
  message_html?: string | null;        // raw HTML for "From eBay" emails (invoices, notices)
  media_urls: string[] | null;
  conversation_type: string | null;   // FROM_MEMBERS (client) | FROM_EBAY (eBay) | BACKMARKET
  sent_by_id: string | null;
  sent_by_name: string | null;
  sent_at: string;
  status: string;
  source?: 'ebay' | 'backmarket' | 'amazon';
  reply_to_email?: string | null;  // Amazon relay address (email-bridge replies)
  subject?: string | null;
}

// A BackMarket message row as stored in Supabase / returned by /api/backmarket/messages.
interface BmMessageRow {
  id: string;
  bm_message_id: string | null;
  group_id: string | null;
  order_id: string | null;
  direction: 'sent' | 'received';
  customer_name: string | null;
  subject: string | null;
  message_text: string;
  media_urls: string[] | null;
  sent_at: string;
  status: string;
}

function bmRowToMessage(r: BmMessageRow): EbayMessage {
  return {
    id: r.id,
    ebay_message_id: r.bm_message_id,
    conversation_id: r.group_id,
    direction: r.direction,
    order_id: r.order_id ?? '',
    item_id: null,
    buyer_username: r.customer_name || 'BackMarket customer',
    sender_username: null,
    buyer_name: r.customer_name,
    item_title: r.subject,
    contact_reason: r.subject,
    message_text: r.message_text,
    media_urls: r.media_urls ?? [],
    conversation_type: 'BACKMARKET',
    sent_by_id: null,
    sent_by_name: null,
    sent_at: r.sent_at,
    status: r.status,
    source: 'backmarket',
  };
}

// An Amazon message row as stored in Supabase / returned by /api/amazon/messages.
// Sent rows come from the SP-API templated send or an email-bridge reply;
// received rows are buyer emails ingested from the marketplace relay mailbox.
interface AmazonMessageRow {
  id: string;
  amazon_order_id: string;
  action: string | null;
  message_text: string;
  direction: 'sent' | 'received';
  status: string;
  subject: string | null;
  reply_to_email: string | null;
  buyer_name: string | null;
  item_title: string | null;
  sent_by_id: string | null;
  sent_by_name: string | null;
  sent_at: string;
}

// Human labels for the SP-API templated message types (used as contact reason
// in threads and as the type picker in the Amazon reply bar).
const AMAZON_ACTION_LABELS: Record<string, string> = {
  confirmCustomizationDetails: 'Confirm customisation details',
  confirmDeliveryDetails: 'Confirm delivery details',
  confirmOrderDetails: 'Confirm order details',
  confirmServiceDetails: 'Confirm service details',
  digitalAccessKey: 'Send digital access key',
  unexpectedProblem: 'Unexpected problem with order',
  negativeFeedbackRemoval: 'Request feedback removal',
};
// Only these carry free text; the rest can't be sent from the reply bar.
const AMAZON_TEXT_ACTIONS = new Set([
  'confirmCustomizationDetails', 'confirmDeliveryDetails', 'confirmOrderDetails',
  'confirmServiceDetails', 'digitalAccessKey', 'unexpectedProblem',
]);

function amazonRowToMessage(r: AmazonMessageRow): EbayMessage {
  return {
    id: r.id,
    ebay_message_id: null,
    // Thread by order; orderless buyer emails thread by their relay address.
    conversation_id: r.amazon_order_id ? `amz-${r.amazon_order_id}` : `amz-email-${r.reply_to_email ?? r.id}`,
    direction: r.direction,
    order_id: r.amazon_order_id,
    item_id: null,
    buyer_username: r.buyer_name || 'Amazon buyer',
    sender_username: null,
    buyer_name: r.buyer_name,
    item_title: r.item_title,
    contact_reason: r.action ? (AMAZON_ACTION_LABELS[r.action] ?? r.action) : r.subject,
    message_text: r.message_text,
    media_urls: [],
    conversation_type: 'AMAZON',
    sent_by_id: r.sent_by_id,
    sent_by_name: r.sent_by_name,
    sent_at: r.sent_at,
    status: r.status,
    source: 'amazon',
    reply_to_email: r.reply_to_email,
    subject: r.subject,
  };
}

// Merge freshly-fetched messages into the cached list (dedup by id) instead of
// replacing it wholesale, so a sync only adds newer messages rather than wiping
// and repopulating the list. Preserves a locally-set "read" status so a
// background refresh doesn't resurrect an "unread" flag we've already cleared.
//
// `keepLocalStatus` (used when opening a thread for reading) additionally keeps a
// locally-"unread" message unread even if the fetched copy says read — so merely
// opening a conversation never marks it read. Read status then only changes via
// an explicit "Mark read" or a background inbox sync.
function mergeInbox(prev: EbayMessage[], fresh: EbayMessage[], keepLocalStatus = false): EbayMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of fresh) {
    const existing = byId.get(m.id);
    if (!existing) { byId.set(m.id, m); continue; }
    const keepRead = existing.status === 'read' && m.status === 'unread';
    const keepUnread = keepLocalStatus && existing.status === 'unread' && m.status === 'read';
    byId.set(m.id, keepRead || keepUnread ? { ...m, status: existing.status } : m);
  }
  return [...byId.values()];
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
  const accessControl = useOrderStore((s) => s.accessControl);
  // Buyer Inbox / email access is governed by the admin-configurable rules
  // (default: Comms + Admin).
  const canInbox = can(currentUser, 'feature:buyer-inbox', accessControl);
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
  const [ebayFilter, setEbayFilter] = useState<'all' | 'unread' | 'client' | 'ebay' | 'backmarket' | 'amazon'>('all');
  const [bmMessages, setBmMessages] = useState<EbayMessage[]>([]);
  const [bmSyncing, setBmSyncing] = useState(false);
  const [amazonMessages, setAmazonMessages] = useState<EbayMessage[]>([]);
  const [amazonSyncing, setAmazonSyncing] = useState(false);
  // Message types Amazon currently allows for the open Amazon thread's order
  // (null = still checking). Amazon only permits templated types per order.
  const [amazonReplyActions, setAmazonReplyActions] = useState<string[] | null>(null);
  const [amazonReplyAction, setAmazonReplyAction] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyImages, setReplyImages] = useState<string[]>([]);
  // Original HTML of an eBay system email (invoice/notice) to render in a modal.
  const [previewHtml, setPreviewHtml] = useState<{ html: string; title: string } | null>(null);
  const [replySending, setReplySending] = useState(false);
  // Multi-select of conversations in the list (for bulk mark read/unread).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const toggleSelected = (key: string) => setSelectedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const clearSelection = () => setSelectedKeys(new Set());

  // Fast read of already-synced messages from our Supabase (no eBay calls).
  async function loadEbayMessages() {
    setEbayLoading(true);
    try {
      const res = await fetch('/api/ebay/messages/inbox');
      if (res.ok) {
        const data = await res.json() as { messages: EbayMessage[] };
        setEbayMessages((prev) => mergeInbox(prev, data.messages));
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

  // BackMarket (SAV) messages — same shape, loaded/synced alongside eBay.
  async function loadBmMessages() {
    try {
      const res = await fetch('/api/backmarket/messages');
      if (res.ok) {
        const data = await res.json() as { messages: BmMessageRow[] };
        setBmMessages((prev) => mergeInbox(prev, data.messages.map(bmRowToMessage)));
      }
    } catch { /* silent */ }
  }
  async function syncBmInbox() {
    setBmSyncing(true);
    try {
      const res = await fetch('/api/backmarket/messages', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { synced: number };
        if (data.synced > 0) toast.success(`${data.synced} new BackMarket message${data.synced !== 1 ? 's' : ''} synced`);
        await loadBmMessages();
      }
    } catch { /* silent */ } finally {
      setBmSyncing(false);
    }
  }
  // Amazon messages — sent history plus buyer emails ingested from the
  // marketplace relay mailbox (SP-API has no buyer-message read API).
  async function loadAmazonMessages() {
    try {
      const res = await fetch('/api/amazon/messages');
      if (res.ok) {
        const data = await res.json() as { messages: AmazonMessageRow[] };
        setAmazonMessages((prev) => mergeInbox(prev, data.messages.map(amazonRowToMessage)));
      }
    } catch { /* silent */ }
  }
  async function syncAmazonInbox() {
    setAmazonSyncing(true);
    try {
      const res = await fetch('/api/amazon/messages', { method: 'POST' });
      if (res.ok) {
        const data = await res.json() as { synced: number };
        if (data.synced > 0) toast.success(`${data.synced} new Amazon message${data.synced !== 1 ? 's' : ''} synced`);
        await loadAmazonMessages();
      } else if (res.status !== 401) {
        // 401 = relay mailbox not configured — quietly skip, like BackMarket.
        const err = await res.json().catch(() => ({})) as { message?: string };
        console.warn('[Amazon inbox] sync failed:', err.message);
      }
    } catch { /* silent */ } finally {
      setAmazonSyncing(false);
    }
  }

  const syncAllInboxes = () => { syncEbayInbox(); syncBmInbox(); syncAmazonInbox(); };

  // Open a conversation for reading. Opening does NOT mark it read — that only
  // happens when the user explicitly hits "Mark read" in the thread or list.
  async function openConversation(convo: Conversation) {
    setActiveKey(convo.key);
    if (!convo.conversation_id) return;

    if (convo.conversation_type === 'AMAZON') {
      // Nothing to refetch (send-only history), but ask Amazon which message
      // types it currently allows so the reply bar knows what it can send.
      setAmazonReplyActions(null);
      setAmazonReplyAction('');
      try {
        const res = await fetch(`/api/amazon/messages?orderId=${encodeURIComponent(convo.order_id)}&actions=1`);
        const data = res.ok ? await res.json() as { actions: string[] } : { actions: [] };
        const textActions = data.actions.filter((a) => AMAZON_TEXT_ACTIONS.has(a));
        setAmazonReplyActions(textActions);
        setAmazonReplyAction(textActions[0] ?? '');
      } catch {
        setAmazonReplyActions([]);
      }
      return;
    }

    if (convo.conversation_type === 'BACKMARKET') {
      try {
        const res = await fetch(`/api/backmarket/messages?savId=${encodeURIComponent(convo.conversation_id)}`);
        if (res.ok) {
          const data = await res.json() as { messages: BmMessageRow[] };
          setBmMessages((prev) => mergeInbox(prev, data.messages.map(bmRowToMessage), true));
        }
      } catch { /* silent */ }
      return;
    }

    try {
      const res = await fetch(`/api/ebay/messages/inbox?conversationId=${encodeURIComponent(convo.conversation_id)}&conversationType=${convo.conversation_type}`);
      if (res.ok) {
        const data = await res.json() as { messages: EbayMessage[] };
        setEbayMessages((prev) => mergeInbox(prev, data.messages, true));
      }
    } catch {
      // silent — the cached latest message is still shown
    }
  }

  useEffect(() => {
    if (tab === 'ebay' && canInbox) {
      /* eslint-disable react-hooks/set-state-in-effect */
      loadEbayMessages();
      syncEbayInbox();
      loadBmMessages();
      syncBmInbox();
      loadAmazonMessages();
      syncAmazonInbox();
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, canInbox]);

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

  // eBay + BackMarket + Amazon messages share one inbox list.
  const allMessages = useMemo(() => [...ebayMessages, ...bmMessages, ...amazonMessages], [ebayMessages, bmMessages, amazonMessages]);

  // Group messages into conversations (by eBay conversation / BackMarket thread, falling back to buyer+order)
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();
    for (const msg of allMessages) {
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
  }, [allMessages, isOurs]);

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

  // Related order in our own system.
  // BackMarket threads carry the real order id → match it directly. eBay matches
  // by listing item id + buyer, falling back to buyer.
  const relatedOrder = useMemo(() => {
    if (!activeConvo) return null;
    if (activeConvo.conversation_type === 'AMAZON') {
      const oid = activeConvo.order_id;
      return orders.find((o) => !o.deletedAt && (o.salesRecordNumber === oid || o.orderNumber === oid)) ?? null;
    }
    if (activeConvo.conversation_type === 'BACKMARKET') {
      const oid = activeConvo.order_id;
      if (!oid) return null;
      return orders.find((o) => !o.deletedAt && (o.salesRecordNumber === oid || o.orderNumber === oid || o.id === `backmarket-${oid}`)) ?? null;
    }
    return orders.find((o) => !o.deletedAt && o.itemNumber && o.itemNumber === activeConvo.item_id && o.buyerUsername === activeConvo.buyer_username)
      ?? orders.find((o) => !o.deletedAt && o.buyerUsername === activeConvo.buyer_username) ?? null;
  }, [activeConvo, orders]);

  const activeIsBm = activeConvo?.conversation_type === 'BACKMARKET';
  const activeIsAmazon = activeConvo?.conversation_type === 'AMAZON';
  // Latest relay address in the thread. Replying by email lands in the buyer's
  // Amazon thread and allows free text — always preferred over the templated
  // SP-API send when the buyer has written to us.
  const amazonReplyEmail = activeIsAmazon
    ? [...(activeConvo?.messages ?? [])].reverse().find((m) => m.direction === 'received' && m.reply_to_email)?.reply_to_email ?? null
    : null;
  const amazonReplySubject = activeIsAmazon
    ? [...(activeConvo?.messages ?? [])].reverse().find((m) => m.direction === 'received' && m.subject)?.subject ?? null
    : null;
  // For BackMarket/Amazon, prefer the matched order's product title.
  // For eBay, fall back to the matched order's product when eBay gives no listing.
  const contextTitle = activeIsBm || activeIsAmazon
    ? (relatedOrder?.itemTitle || activeConvo?.item_title || (activeIsAmazon ? 'Amazon order' : 'BackMarket order'))
    : (listing?.title || activeConvo?.item_title || relatedOrder?.itemTitle || 'Listing');

  const unreadTotal = useMemo(() => conversations.reduce((s, c) => s + c.unreadCount, 0), [conversations]);

  async function setConversationRead(convo: Conversation, read: boolean) {
    const ids = convo.messages.filter(m => m.direction === 'received').map(m => m.id);
    if (ids.length === 0) return;
    // Skip the no-op case (marking read when nothing is unread)
    if (read && !convo.messages.some(m => m.direction === 'received' && m.status === 'unread')) return;

    const isBm = convo.conversation_type === 'BACKMARKET';
    const isAmazon = convo.conversation_type === 'AMAZON';
    const setter = isAmazon ? setAmazonMessages : isBm ? setBmMessages : setEbayMessages;
    setter(prev => prev.map(m => ids.includes(m.id) ? { ...m, status: read ? 'read' : 'unread' } : m));

    if (isAmazon) {
      await fetch('/api/amazon/messages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, read }),
      });
      return;
    }
    if (isBm) {
      await fetch('/api/backmarket/messages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, read }),
      });
      return;
    }
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

  // Bulk mark the currently-selected conversations, then clear the selection.
  async function bulkSetRead(read: boolean) {
    const convos = conversations.filter((c) => selectedKeys.has(c.key));
    clearSelection();
    await Promise.all(convos.map((c) => setConversationRead(c, read)));
  }

  async function handleReply() {
    if (!activeConvo || (!replyText.trim() && replyImages.length === 0)) return;
    setReplySending(true);
    try {
      // Amazon reply — via the email relay when the buyer has written to us
      // (free text, threads into their Amazon inbox), otherwise the templated
      // SP-API message (only if Amazon returned an allowed type for the order).
      if (activeConvo.conversation_type === 'AMAZON') {
        if (!replyText.trim()) { toast.error('Enter a message'); return; }
        if (!amazonReplyEmail && !amazonReplyAction) { toast.error('Amazon does not allow contacting this buyer right now'); return; }
        const payload = amazonReplyEmail
          ? {
              replyToEmail: amazonReplyEmail,
              subject: amazonReplySubject ? (amazonReplySubject.startsWith('Re:') ? amazonReplySubject : `Re: ${amazonReplySubject}`) : undefined,
              orderId: activeConvo.order_id,
              text: replyText,
              buyerName: activeConvo.buyer_name,
              itemTitle: activeConvo.item_title,
              sentById: currentUser?.id,
              sentByName: currentUser?.name,
            }
          : {
              orderId: activeConvo.order_id,
              action: amazonReplyAction,
              text: replyText,
              buyerName: activeConvo.buyer_name,
              itemTitle: activeConvo.item_title,
              sentById: currentUser?.id,
              sentByName: currentUser?.name,
            };
        const res = await fetch('/api/amazon/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
          toast.error(`Send failed: ${err.message || err.error || 'Unknown error'}`);
          return;
        }
        toast.success('Message sent via Amazon');
        setReplyText('');
        await loadAmazonMessages();
        return;
      }

      // BackMarket reply → SAV thread (text only; attachments not supported on send here).
      if (activeConvo.conversation_type === 'BACKMARKET') {
        if (!replyText.trim()) { toast.error('Enter a message'); return; }
        const res = await fetch('/api/backmarket/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ savId: activeConvo.conversation_id, message: replyText }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string };
          toast.error(`Send failed: ${err.message || 'Unknown error'}`);
          return;
        }
        toast.success('Reply sent');
        setReplyText('');
        setReplyImages([]);
        await loadBmMessages();
        return;
      }

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
          <p className="text-slate-500 text-sm mt-1">Team notes and eBay, BackMarket &amp; Amazon messages</p>
        </div>
        {tab === 'ebay' && canInbox && (
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
        {canInbox && (
        <button
          onClick={() => { setTab('ebay'); setSearch(''); setActiveKey(null); }}
          className={`px-5 py-2 font-medium transition-colors flex items-center gap-1.5 ${tab === 'ebay' ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          <Inbox className="h-4 w-4" />
          Inbox
          {unreadTotal > 0 && <span className="ml-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unreadTotal}</span>}
        </button>
        )}
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

      {/* ── EBAY INBOX TAB — Gmail-style two panes (Comms + Admin only) ── */}
      {tab === 'ebay' && canInbox && (
        <div className="flex gap-3 h-[calc(100vh-12rem)] min-h-[420px]">
          {/* LEFT PANE — conversation list (full width on mobile until one is opened) */}
          <div className={`${activeConvo ? 'hidden md:flex' : 'flex'} w-full md:w-[320px] shrink-0 flex-col border border-slate-200 rounded-xl overflow-hidden bg-white`}>
            {(() => {
              const filtered = conversations.filter((c) => {
                if (search && !(c.buyer_username.toLowerCase().includes(search.toLowerCase()) || c.order_id.toLowerCase().includes(search.toLowerCase()) || (c.buyer_name ?? '').toLowerCase().includes(search.toLowerCase()))) return false;
                if (ebayFilter === 'unread') return c.unreadCount > 0;
                if (ebayFilter === 'client') return c.conversation_type === 'FROM_MEMBERS';
                if (ebayFilter === 'ebay') return c.conversation_type === 'FROM_EBAY';
                if (ebayFilter === 'backmarket') return c.conversation_type === 'BACKMARKET';
                if (ebayFilter === 'amazon') return c.conversation_type === 'AMAZON';
                return true;
              });
              const bmCount = conversations.filter((c) => c.conversation_type === 'BACKMARKET').length;
              const amazonCount = conversations.filter((c) => c.conversation_type === 'AMAZON').length;
              const FILTERS: { key: typeof ebayFilter; label: string }[] = [
                { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' },
                { key: 'client', label: 'Client' }, { key: 'ebay', label: 'eBay' },
                ...(bmCount > 0 ? [{ key: 'backmarket' as const, label: 'BackMarket' }] : []),
                ...(amazonCount > 0 ? [{ key: 'amazon' as const, label: 'Amazon' }] : []),
              ];
              return (
                <>
                  <div className="border-b shrink-0">
                    {selectedKeys.size > 0 ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 text-white">
                        <span className="text-xs font-medium">{selectedKeys.size} selected</span>
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={() => bulkSetRead(true)} title="Mark selected as read"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/15">
                            <MailOpen className="h-3.5 w-3.5" /> Read
                          </button>
                          <button onClick={() => bulkSetRead(false)} title="Mark selected as unread"
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-white/15">
                            <Mail className="h-3.5 w-3.5" /> Unread
                          </button>
                          <button onClick={clearSelection} title="Clear selection"
                            className="text-xs px-2 py-1 rounded hover:bg-white/15">✕</button>
                        </div>
                      </div>
                    ) : (
                    <div className="flex items-center justify-between px-3 py-2">
                      <p className="text-xs text-slate-400">{filtered.length} of {conversations.length}</p>
                      <button onClick={syncAllInboxes} disabled={ebaySyncing || bmSyncing || amazonSyncing} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 disabled:opacity-50">
                        <RefreshCw className={`h-3 w-3 ${ebaySyncing || bmSyncing || amazonSyncing ? 'animate-spin' : ''}`} /> {ebaySyncing || bmSyncing || amazonSyncing ? 'Syncing…' : 'Sync'}
                      </button>
                    </div>
                    )}
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
                    {(ebayLoading || ebaySyncing) && conversations.length === 0 ? (
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
                          const isBm = convo.conversation_type === 'BACKMARKET';
                          const isAmazon = convo.conversation_type === 'AMAZON';
                          const accent = isActive ? (isAmazon ? 'bg-orange-50 border-orange-500' : isBm ? 'bg-teal-50 border-teal-500' : isEbay ? 'bg-blue-50 border-blue-500' : 'bg-amber-50 border-amber-500')
                            : convo.unreadCount > 0 ? (isBm ? 'bg-teal-50/40 border-transparent hover:bg-slate-50' : isEbay ? 'bg-blue-50/40 border-transparent hover:bg-slate-50' : 'bg-amber-50/40 border-transparent hover:bg-slate-50')
                            : 'border-transparent hover:bg-slate-50';
                          const badge = isAmazon
                            ? { cls: 'bg-orange-100 text-orange-700', label: 'Amazon' }
                            : isBm ? { cls: 'bg-teal-100 text-teal-700', label: 'BackMarket' }
                            : isEbay ? { cls: 'bg-blue-100 text-blue-700', label: 'eBay' }
                            : { cls: 'bg-slate-100 text-slate-500', label: 'Client' };
                          const isSelected = selectedKeys.has(convo.key);
                          return (
                            <div key={convo.key}
                              className={`group flex items-start gap-2 px-3 py-2.5 transition-colors border-l-2 ${isSelected ? 'bg-slate-100 border-slate-400' : accent}`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(convo.key)}
                                onClick={(e) => e.stopPropagation()}
                                title="Select conversation"
                                className={`mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-slate-700 ${isSelected ? '' : 'opacity-0 group-hover:opacity-100'}`}
                              />
                              <div onClick={() => openConversation(convo)} className="min-w-0 flex-1 cursor-pointer">
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold shrink-0 ${badge.cls}`}>{badge.label}</span>
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
                              <p className="text-[11px] text-slate-400 truncate">{convo.order_id ? `Order #${convo.order_id}` : 'No order reference'}{convo.item_title ? ` · ${convo.item_title.slice(0, 40)}` : ''}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {convo.unreadCount > 0 && <span className="bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 leading-tight py-0.5 shrink-0">{convo.unreadCount}</span>}
                                <p className={`text-xs truncate ${convo.unreadCount > 0 ? 'text-slate-700' : 'text-slate-500'}`}>
                                  {last && isOurs(last, convo.buyer_username) ? '↑ ' : '↓ '}{htmlEmailToText(last?.message_text ?? '')}{(last?.media_urls?.length ?? 0) > 0 ? ' 📎' : ''}
                                </p>
                              </div>
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
                  <img src={activeIsAmazon ? PLATFORM_LOGOS.amazon : activeIsBm ? PLATFORM_LOGOS.backmarket : PLATFORM_LOGOS.ebay} alt="platform" className="h-5 w-auto object-contain shrink-0" />
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
                      <p className="text-xs font-medium text-slate-700 truncate">{contextTitle}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {listing?.price != null && <span className="text-xs text-slate-500">{listing.currency === 'GBP' ? '£' : ''}{Number(listing.price).toFixed(2)}</span>}
                        {activeIsBm && activeConvo.item_title && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">{activeConvo.item_title}</span>
                        )}
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
                        {msg.message_text && <p className="whitespace-pre-wrap leading-relaxed">{htmlEmailToText(msg.message_text)}</p>}
                        {msg.message_html && (() => {
                          const isInvoice = /invoice/i.test(`${msg.contact_reason ?? ''} ${msg.message_text}`);
                          return (
                            <button
                              onClick={() => setPreviewHtml({ html: msg.message_html!, title: msg.contact_reason || 'eBay message' })}
                              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {isInvoice ? 'Preview invoice' : 'View full message'}
                            </button>
                          );
                        })()}
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
                {activeIsAmazon ? (
                  <div className="border-t p-2 shrink-0 space-y-2">
                    {amazonReplyEmail ? (
                      <div className="flex items-end gap-2">
                        <textarea
                          className="flex-1 border rounded-xl px-3 py-2 text-sm min-h-[40px] max-h-32 resize-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                          placeholder="Type your reply…"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                          rows={1}
                          maxLength={4000}
                        />
                        <Button
                          onClick={handleReply}
                          disabled={!replyText.trim() || replySending}
                          className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
                          size="sm"
                        >
                          <Send className="h-3.5 w-3.5 sm:mr-1.5" />
                          <span className="hidden sm:inline">{replySending ? 'Sending…' : 'Reply'}</span>
                        </Button>
                      </div>
                    ) : amazonReplyActions === null ? (
                      <p className="text-xs text-slate-400 px-1 py-2">Checking which message types Amazon allows for this order…</p>
                    ) : amazonReplyActions.length === 0 ? (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        Amazon does not currently allow contacting this buyer (messaging window closed or the buyer opted out).
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-1">
                          <span className="text-xs text-slate-400 shrink-0">Type:</span>
                          <select
                            value={amazonReplyAction}
                            onChange={(e) => setAmazonReplyAction(e.target.value)}
                            className="text-xs border rounded-md px-2 py-1 bg-white text-slate-600"
                          >
                            {amazonReplyActions.map((a) => (
                              <option key={a} value={a}>{AMAZON_ACTION_LABELS[a] ?? a}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end gap-2">
                          <textarea
                            className="flex-1 border rounded-xl px-3 py-2 text-sm min-h-[40px] max-h-32 resize-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
                            placeholder="Type your message to the buyer…"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                            rows={1}
                            maxLength={2000}
                          />
                          <Button
                            onClick={handleReply}
                            disabled={!replyText.trim() || replySending}
                            className="bg-orange-500 hover:bg-orange-600 text-white shrink-0"
                            size="sm"
                          >
                            <Send className="h-3.5 w-3.5 sm:mr-1.5" />
                            <span className="hidden sm:inline">{replySending ? 'Sending…' : 'Send'}</span>
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
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
                )}
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

      {/* eBay email preview — original HTML rendered in a sandboxed iframe */}
      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPreviewHtml(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <img src={PLATFORM_LOGOS.ebay} alt="eBay" className="h-4 w-auto object-contain shrink-0" />
                <span className="text-sm font-medium text-slate-700 truncate">{previewHtml.title}</span>
              </div>
              <button onClick={() => setPreviewHtml(null)} className="text-slate-400 hover:text-slate-700 shrink-0" title="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* sandbox without allow-scripts: the email's markup renders but can't run code or navigate our app */}
            <iframe
              srcDoc={previewHtml.html}
              sandbox=""
              title="Email preview"
              className="flex-1 w-full bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}
