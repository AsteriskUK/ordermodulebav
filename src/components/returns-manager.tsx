'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOrderStore } from '@/lib/store';
import { ReturnRecord, ReplacementItem, Department, DEPARTMENT_CONFIG } from '@/lib/types';
import { ImageUpload } from '@/components/image-upload';
import { RETURN_IMAGE_BUCKET, REPLACEMENT_IMAGE_BUCKET } from '@/lib/image-upload';
import { OrderDetailDialog } from '@/components/order-detail-dialog';
import { ReturnLabelDialog } from '@/components/return-label-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { PackageOpen, Plus, Search, CheckCircle, Truck, Replace, Pencil, ArrowLeftRight, Loader2, Eye, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useSettingList, useSettingNumber, useSettingString, useSettingBool } from '@/hooks/use-settings';

type EbayReturnAction =
  | 'SELLER_MARK_AS_RECEIVED'
  | 'SELLER_MARK_REPLACEMENT_SHIPPED'
  | 'SELLER_ISSUE_REFUND'
  | 'SELLER_VOID_LABEL'
  | 'SELLER_OFFER_PARTIAL_REFUND'
  | 'SUBMIT_FILE';



const STATUS_CONFIG: Record<ReturnRecord['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  received: { label: 'Received', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  refunded: { label: 'Refunded', color: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
  replacement: { label: 'Replacement', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  swap: { label: 'Swap — awaiting item', color: 'bg-orange-100 text-orange-800 border-orange-300' },
};

function derivePlatform(batchId?: string): ReturnRecord['platform'] | undefined {
  const prefix = batchId?.split('-')[0]?.toLowerCase();
  if (['ebay', 'amazon', 'backmarket', 'onbuy', 'temu'].includes(prefix || '')) return prefix as ReturnRecord['platform'];
  return undefined;
}

function isEbayActionAvailable(
  ret: ReturnRecord,
  actionType: EbayReturnAction,
  ebayReturns: Array<{ return_id: string; raw?: Record<string, unknown> }>
): boolean {
  if (ret.platform !== 'ebay' || !ret.ebayReturnId) return true; // non-eBay or unlinked: always allow
  const ebayReturn = ebayReturns.find((e) => e.return_id === ret.ebayReturnId);
  if (!ebayReturn?.raw) return true; // allow if cached data missing; eBay will reject if truly unavailable
  const summary = (ebayReturn.raw.summary as Record<string, unknown> | undefined) || ebayReturn.raw;
  const options = (summary.sellerAvailableOptions as Array<{ actionType: string }> | undefined) || [];
  return options.some((o) => o.actionType === actionType);
}

// eBay-synced reasons arrive as ALL-CAPS enums (e.g. "DEFECTIVE ITEM") —
// sentence-case those for display; manually-entered reasons pass through as-is.
function prettyReason(r?: string): string {
  if (!r) return '';
  const t = r.replace(/_/g, ' ').trim();
  return /^[A-Z0-9 ]+$/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

function genId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function ReturnsManager() {
  // Configurable behaviour (Settings → Returns & Tickets / Shipping).
  const RETURN_REASONS = useSettingList('returns.reasons');
  const swapDefaultWeightKg = useSettingNumber('shipping.defaultWeightKg');
  const defaultSwapMethod = useSettingString('returns.defaultSwapMethod') as 'collection' | 'label';
  const emailLabelByDefault = useSettingBool('returns.emailLabelToCustomer');

  const orders = useOrderStore((s) => s.orders);
  const returns = useOrderStore((s) => s.returns);
  const users = useOrderStore((s) => s.users);
  const currentUserId = useOrderStore((s) => s.currentUserId);
  const addReturn = useOrderStore((s) => s.addReturn);
  const updateReturn = useOrderStore((s) => s.updateReturn);
  const processReturn = useOrderStore((s) => s.processReturn);
  const addReplacementItem = useOrderStore((s) => s.addReplacementItem);
  const createReplacementOrder = useOrderStore((s) => s.createReplacementOrder);

  const currentUser = users.find((u) => u.id === currentUserId);

  const searchParams = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');

  useEffect(() => {
    const q = searchParams.get('search');
    if (q) setSearch(q);
  }, [searchParams]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [ebayReturns, setEbayReturns] = useState<Array<{ return_id: string; order_id: string | null; item_id: string | null; item_title: string | null; image_url: string | null; state: string | null; status: string | null; raw?: Record<string, unknown> }>>([]);
  // Quick-action deep link (?new=1&order=&buyer=&kind=&notes=) opens the form prefilled.
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1');

  // Replacement / swap dialog — swap = send the replacement before the faulty item comes back
  const [replaceReturn, setReplaceReturn] = useState<ReturnRecord | null>(null);
  const [replaceMode, setReplaceMode] = useState<'replacement' | 'swap'>('replacement');
  const [replacementItemTitle, setReplacementItemTitle] = useState('');
  const [replacementQty, setReplacementQty] = useState('1');
  const [replacementNotes, setReplacementNotes] = useState('');
  const [replacementImageUrls, setReplacementImageUrls] = useState<string[]>([]);
  const [swapMethod, setSwapMethod] = useState<'collection' | 'label'>(defaultSwapMethod);
  const [swapBoxes, setSwapBoxes] = useState('1');
  const [swapEmailLabel, setSwapEmailLabel] = useState(emailLabelByDefault);
  const [swapSubmitting, setSwapSubmitting] = useState(false);

  // Receive dialog
  const [receiveReturn, setReceiveReturn] = useState<ReturnRecord | null>(null);
  const [receiveNotes, setReceiveNotes] = useState('');

  // Refund confirm dialog
  const [refundReturn, setRefundReturn] = useState<ReturnRecord | null>(null);
  const [refundAmountConfirm, setRefundAmountConfirm] = useState('');

  // View linked original order
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  // Return details pane (opens on row / listing / case click)
  const [detailReturn, setDetailReturn] = useState<ReturnRecord | null>(null);

  // Edit dialog
  const [editReturn, setEditReturn] = useState<ReturnRecord | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editRefundAmount, setEditRefundAmount] = useState('');
  const [editResponsibleDepartment, setEditResponsibleDepartment] = useState<Department | ''>('');
  const [editResponsibleUserId, setEditResponsibleUserId] = useState('');
  const [editReturnTrackingNumber, setEditReturnTrackingNumber] = useState('');
  const [editReceivedNotes, setEditReceivedNotes] = useState('');
  const [editStatus, setEditStatus] = useState<ReturnRecord['status']>('pending');
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editEbayReturnId, setEditEbayReturnId] = useState('');

  // Populate + open the Edit dialog for a return (shared by table + details pane).
  const openEdit = (ret: ReturnRecord) => {
    setEditReturn(ret);
    setEditReason(ret.reason);
    setEditNotes(ret.notes);
    setEditRefundAmount(ret.refundAmount?.toFixed(2) ?? '');
    setEditResponsibleDepartment(ret.responsibleDepartment || '');
    setEditResponsibleUserId(ret.responsibleUserId || '');
    setEditReturnTrackingNumber(ret.returnTrackingNumber || '');
    setEditReceivedNotes(ret.receivedNotes || '');
    setEditStatus(ret.status);
    setEditImageUrls(ret.imageUrls || []);
    setEditEbayReturnId(ret.ebayReturnId || '');
  };

  // New return form
  const [newReturnId, setNewReturnId] = useState('');
  const [orderSearch, setOrderSearch] = useState(() =>
    searchParams.get('new') === '1' ? (searchParams.get('order') || searchParams.get('buyer') || '') : ''
  );
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [reason, setReason] = useState(RETURN_REASONS[0] ?? '');
  const [notes, setNotes] = useState(() => {
    if (searchParams.get('new') !== '1') return '';
    const seed = searchParams.get('notes') || '';
    const prefix = { return: 'Return requested', refund: 'Refund requested', cancel: 'Cancellation requested' }[searchParams.get('kind') || ''] || '';
    return [prefix, seed].filter(Boolean).join(' — ');
  });
  const [refundAmount, setRefundAmount] = useState('');
  const [responsibleDepartment, setResponsibleDepartment] = useState<Department | ''>('');
  const [responsibleUserId, setResponsibleUserId] = useState('');
  const [returnTrackingNumber, setReturnTrackingNumber] = useState('');
  const [returnImageUrls, setReturnImageUrls] = useState<string[]>([]);
  const [ebayReturnId, setEbayReturnId] = useState(() => searchParams.get('ebayReturnId') || '');

  useEffect(() => {
    const newEbayReturnId = searchParams.get('ebayReturnId') || '';
    const newNotes = searchParams.get('notes') || '';
    if (newEbayReturnId) setEbayReturnId(newEbayReturnId);
    if (newNotes && !notes) setNotes(newNotes);
  }, [searchParams]);

  // Deep link auto-select: once orders load, match the order number from the URL.
  useEffect(() => {
    if (searchParams.get('new') !== '1' || selectedOrderId) return;
    const orderQ = searchParams.get('order');
    if (!orderQ) return;
    const match = orders.find((o) => o.salesRecordNumber === orderQ || o.orderNumber === orderQ);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setSelectedOrderId(match.id);
  }, [orders, selectedOrderId, searchParams]);

  // Load eBay return cases so we can auto-link local returns, show thumbnails/case
  // links and eBay actions.
  const loadEbayReturns = () => {
    fetch('/api/ebay/returns')
      .then((res) => res.json())
      .then((data) => setEbayReturns(data.returns ?? []))
      .catch(() => { /* silent */ });
  };
  useEffect(() => { loadEbayReturns(); }, []);

  // Pull the latest returns from the marketplaces (auto-creates local records).
  const [syncing, setSyncing] = useState<null | 'ebay' | 'amazon'>(null);
  const syncEbayReturns = async () => {
    setSyncing('ebay');
    try {
      const res = await fetch('/api/ebay/returns', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { toast.success(`Synced ${data.synced ?? 0} eBay returns${data.created ? ` — ${data.created} new` : ''}`); loadEbayReturns(); }
      else toast.error(`eBay returns sync failed: ${data.message || data.error || 'error'}`);
    } catch { toast.error('eBay returns sync failed'); } finally { setSyncing(null); }
  };
  const syncAmazonReturns = async () => {
    setSyncing('amazon');
    try {
      const res = await fetch('/api/amazon/returns', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.pending) toast.info(data.message || 'Amazon returns report generating — sync again shortly.');
      else if (res.ok) toast.success(`Synced ${data.synced ?? 0} Amazon returns${data.created ? ` — ${data.created} new` : ''}`);
      else toast.error(`Amazon returns sync failed: ${data.message || data.error || 'error'}`);
    } catch { toast.error('Amazon returns sync failed'); } finally { setSyncing(null); }
  };

  // Listing thumbnail / listing link / case number for a return, by platform.
  const returnListing = (ret: ReturnRecord): { thumb: string | null; listingUrl: string | null; caseNumber: string | null; caseUrl: string | null } => {
    if (ret.platform === 'ebay' && ret.ebayReturnId) {
      const er = ebayReturns.find((e) => e.return_id === ret.ebayReturnId);
      return {
        thumb: er?.image_url ?? null,
        listingUrl: er?.item_id ? `https://www.ebay.co.uk/itm/${er.item_id}` : null,
        caseNumber: ret.ebayReturnId,
        caseUrl: `https://www.ebay.co.uk/returns/rtn?returnId=${ret.ebayReturnId}`,
      };
    }
    if (ret.platform === 'amazon') {
      return {
        thumb: null,
        listingUrl: ret.asin ? `https://www.amazon.co.uk/dp/${ret.asin}` : null,
        caseNumber: ret.amazonRmaId ?? null,
        caseUrl: null,
      };
    }
    return { thumb: null, listingUrl: null, caseNumber: null, caseUrl: null };
  };

  // Auto-link local returns to eBay return cases by order number / item title.
  useEffect(() => {
    if (ebayReturns.length === 0) return;
    returns.forEach((ret) => {
      if (ret.ebayReturnId) return;
      const order = orders.find((o) => o.id === ret.orderId);
      if (!order) return;
      const orderNumber = order.orderNumber || order.salesRecordNumber;
      const candidates = ebayReturns.filter((e) => e.order_id === orderNumber || e.order_id === order.salesRecordNumber);
      if (candidates.length === 0) return;
      const match = candidates.length === 1
        ? candidates[0]
        : candidates.find((e) => e.item_title && (order.itemTitle || ret.itemTitle).toLowerCase().includes(e.item_title.toLowerCase()));
      if (match) updateReturn(ret.id, { ebayReturnId: match.return_id, platform: 'ebay' });
    });
  }, [ebayReturns, orders, returns]);

  const orderSuggestions = useMemo(() => {
    if (!orderSearch.trim()) return [];
    const q = orderSearch.toLowerCase();
    return orders
      .filter((o) =>
        o.salesRecordNumber.toLowerCase().includes(q) ||
        o.postToName.toLowerCase().includes(q) ||
        o.itemTitle.toLowerCase().includes(q) ||
        o.buyerUsername.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [orders, orderSearch]);

  const openStatuses: ReturnRecord['status'][] = ['pending', 'received', 'swap'];
  const closedStatuses: ReturnRecord['status'][] = ['refunded', 'rejected', 'replacement'];

  const filteredReturns = useMemo(() => {
    let r = [...returns].sort((a, b) => b.returnedAt.localeCompare(a.returnedAt));
    r = r.filter((x) => (tab === 'open' ? openStatuses : closedStatuses).includes(x.status));
    if (statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter);
    if (platformFilter !== 'all') r = r.filter((x) => (x.platform || 'manual') === platformFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.salesRecordNumber.toLowerCase().includes(q) ||
          x.orderNumber.toLowerCase().includes(q) ||
          x.buyerUsername.toLowerCase().includes(q) ||
          x.itemTitle.toLowerCase().includes(q) ||
          x.reason.toLowerCase().includes(q) ||
          (x.processedByUserName || '').toLowerCase().includes(q) ||
          (x.responsibleUserName || '').toLowerCase().includes(q) ||
          (x.responsibleDepartment || '').toLowerCase().includes(q)
      );
    }
    return r;
  }, [returns, statusFilter, platformFilter, search, tab]);

  const selectedOrder = orders.find((o) => o.id === selectedOrderId);

  // DPD return-label dialog opened from the Log Return form / returns table.
  const [labelTarget, setLabelTarget] = useState<{ order: (typeof orders)[number]; returnId: string } | null>(null);

  const handleSubmit = (opts?: { generateLabel?: boolean }) => {
    if (!selectedOrderId) { toast.error('Select an order'); return; }
    const order = orders.find((o) => o.id === selectedOrderId);
    if (!order) return;
    const platform = derivePlatform(order.batchId) || 'manual';
    const ret: ReturnRecord = {
      id: newReturnId || genId(),
      orderId: selectedOrderId,
      salesRecordNumber: order.salesRecordNumber,
      orderNumber: order.orderNumber,
      buyerUsername: order.buyerUsername,
      itemTitle: order.itemTitle,
      reason,
      notes,
      returnedAt: new Date().toISOString(),
      createdByUserId: currentUser?.id,
      createdByUserName: currentUser?.name,
      refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
      returnTrackingNumber: returnTrackingNumber.trim() || undefined,
      responsibleDepartment: responsibleDepartment || undefined,
      responsibleUserId: responsibleUserId || undefined,
      responsibleUserName: responsibleUserId ? users.find((u) => u.id === responsibleUserId)?.name : undefined,
      status: 'pending',
      imageUrls: returnImageUrls.length > 0 ? returnImageUrls : undefined,
      ebayReturnId: ebayReturnId.trim() || undefined,
      platform: (ebayReturnId.trim() ? 'ebay' : platform) as ReturnRecord['platform'],
    };
    addReturn(ret);
    toast.success(`Return logged for order #${order.salesRecordNumber}`);
    // Optionally go straight into issuing a DPD return label for this return.
    if (opts?.generateLabel) setLabelTarget({ order, returnId: ret.id });
    setShowForm(false);
    setOrderSearch('');
    setSelectedOrderId('');
    setNotes('');
    setRefundAmount('');
    setReason(RETURN_REASONS[0] ?? '');
    setResponsibleDepartment('');
    setResponsibleUserId('');
    setReturnTrackingNumber('');
    setReturnImageUrls([]);
    setEbayReturnId('');
  };

  const closeReplaceDialog = () => {
    setReplaceReturn(null);
    setReplacementItemTitle('');
    setReplacementQty('1');
    setReplacementNotes('');
    setReplacementImageUrls([]);
    setSwapMethod('collection');
    setSwapBoxes('1');
    setSwapEmailLabel(emailLabelByDefault);
  };

  // Call an eBay Post-Order return action. Returns true if eBay accepted it.
  const performEbayAction = async (ret: ReturnRecord, actionType: EbayReturnAction, payload?: Record<string, unknown>) => {
    if (ret.platform !== 'ebay' || !ret.ebayReturnId) return true;
    const res = await fetch(`/api/ebay/returns/${ret.ebayReturnId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(`eBay action failed: ${data.message || data.error || 'unknown error'}`);
      return false;
    }
    toast.success('Updated on eBay');
    return true;
  };

  // Books the DPD collection or issues a return label for the faulty item on a swap.
  const initiateSwapReturn = async (ret: ReturnRecord) => {
    const order = orders.find((o) => o.id === ret.orderId);
    if (!order) throw new Error('Original order not found — issue the DPD return manually');
    const endpoint = swapMethod === 'collection' ? '/api/dpd/create-collection' : '/api/dpd/create-return';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Weight is no longer collected in the UI — DPD needs a value, so default to 20 kg.
        weight: swapDefaultWeightKg,
        boxes: parseInt(swapBoxes, 10) || 1,
        reference: order.salesRecordNumber,
        ...(swapMethod === 'label' ? { sendEmail: swapEmailLabel } : {}),
        customer: {
          name: order.postToName || order.buyerName,
          phone: order.postToPhone,
          email: order.buyerEmail,
          address1: order.postToAddress1,
          address2: order.postToAddress2,
          city: order.postToCity,
          county: order.postToCounty,
          postcode: order.postToPostcode,
          country: order.postToCountry,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'DPD request failed');
    updateReturn(ret.id, {
      swapReturnMethod: swapMethod,
      returnTrackingNumber: data.trackingNumber || ret.returnTrackingNumber,
    });
    // Return labels come back printable — open the print window straight away.
    if (swapMethod === 'label' && data.labelHtml) {
      const win = window.open('', '_swap_return_label');
      if (win) {
        win.document.write(`<html><body style="margin:0">${data.labelHtml}</body></html>`);
        win.document.close();
        win.onload = () => win.print();
      }
    }
    return data;
  };

  const handleCreateReplacement = async () => {
    if (!replaceReturn) return;
    const title = replacementItemTitle.trim();
    if (!title) { toast.error('Enter replacement item title'); return; }
    const qty = parseInt(replacementQty, 10);
    if (isNaN(qty) || qty < 1) { toast.error('Enter a valid quantity'); return; }

    const item: ReplacementItem = {
      itemTitle: title,
      quantity: qty,
      notes: replacementNotes.trim() || undefined,
      imageUrls: replacementImageUrls.length > 0 ? replacementImageUrls : undefined,
    };
    addReplacementItem(replaceReturn.id, item);
    processReturn(replaceReturn.id, replaceMode, currentUser?.id || '', currentUser?.name || '');
    // On a swap, the box count entered for the collection also sizes the outbound (send) order.
    const boxes = parseInt(swapBoxes, 10) || 1;
    const newOrder = createReplacementOrder(
      replaceReturn.id,
      replaceMode === 'swap' ? { numberOfBoxes: boxes, labelQty: boxes } : undefined,
    );

    if (replaceMode === 'swap') {
      setSwapSubmitting(true);
      try {
        const data = await initiateSwapReturn(replaceReturn);
        await performEbayAction(replaceReturn, 'SELLER_MARK_REPLACEMENT_SHIPPED', {
          replacementShipment: { trackingNumber: data.trackingNumber, carrierEnum: 'DPD', shippingMethod: 'SELLER_SHIPPED' },
        });
        toast.success(
          swapMethod === 'collection'
            ? `Swap order #${newOrder.salesRecordNumber} created — DPD collection booked and eBay updated (${data.trackingNumber})`
            : `Swap order #${newOrder.salesRecordNumber} created — DPD return label issued and eBay updated (${data.trackingNumber})`
        );
      } catch (err) {
        // The swap order exists either way — the DPD return can be issued again from the order.
        toast.error(`Swap order #${newOrder.salesRecordNumber} created, but DPD/eBay failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setSwapSubmitting(false);
      }
    } else {
      await performEbayAction(replaceReturn, 'SELLER_MARK_REPLACEMENT_SHIPPED', {
        replacementShipment: { trackingNumber: newOrder.trackingNumber || '', shippingMethod: 'SELLER_SHIPPED' },
      });
      toast.success(`Replacement order #${newOrder.salesRecordNumber} created and eBay updated`);
    }
    closeReplaceDialog();
  };

  const totalRefunded = returns
    .filter((r) => r.status === 'refunded')
    .reduce((s, r) => s + (r.refundAmount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Returns &amp; Refunds</h2>
          <p className="text-slate-500 text-sm mt-1">Track and process customer returns</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={syncEbayReturns} disabled={syncing !== null}>
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing === 'ebay' ? 'animate-spin' : ''}`} />
            Sync eBay
          </Button>
          <Button size="sm" variant="outline" onClick={syncAmazonReturns} disabled={syncing !== null}>
            <RefreshCw className={`h-3 w-3 mr-1 ${syncing === 'amazon' ? 'animate-spin' : ''}`} />
            Sync Amazon
          </Button>
          <Button size="sm" onClick={() => { setNewReturnId(genId()); setShowForm((v) => !v); }}>
            <Plus className="h-3 w-3 mr-1" />
            Log Return
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {(['pending', 'received', 'swap', 'refunded', 'rejected', 'replacement'] as ReturnRecord['status'][]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          const count = returns.filter((r) => r.status === s).length;
          return (
            <Card key={s} className="cursor-pointer" onClick={() => { setStatusFilter(s); setTab(openStatuses.includes(s) ? 'open' : 'closed'); }}>
              <CardContent className="pt-5 pb-4">
                <div className={`text-2xl font-bold`}>{count}</div>
                <Badge variant="outline" className={`text-xs mt-1 ${cfg.color}`}>{cfg.label}</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Open / Closed tabs */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('open')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'open' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Open ({returns.filter((r) => openStatuses.includes(r.status)).length})
        </button>
        <button
          onClick={() => setTab('closed')}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            tab === 'closed' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Closed ({returns.filter((r) => closedStatuses.includes(r.status)).length})
        </button>
      </div>

      {/* New return form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader><CardTitle className="text-sm text-blue-800">Log New Return</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Search Order</label>
              <Input
                value={orderSearch}
                onChange={(e) => { setOrderSearch(e.target.value); setSelectedOrderId(''); }}
                placeholder="Order #, customer name, item..."
                className="h-8 text-sm"
              />
              {orderSuggestions.length > 0 && !selectedOrderId && (
                <div className="border rounded-md mt-1 bg-white shadow-sm divide-y">
                  {orderSuggestions.map((o) => (
                    <button
                      key={o.id}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"
                      onClick={() => { setSelectedOrderId(o.id); setOrderSearch(`#${o.salesRecordNumber} — ${o.postToName}`); }}
                    >
                      <span className="font-mono text-slate-400 mr-2">#{o.salesRecordNumber}</span>
                      <span className="font-medium">{o.postToName}</span>
                      <span className="text-slate-400 ml-2 truncate">{o.itemTitle.substring(0, 50)}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedOrder && (
                <div className="mt-2 p-2 bg-white rounded border text-xs">
                  <p className="font-medium">{selectedOrder.itemTitle}</p>
                  <p className="text-slate-400">£{selectedOrder.totalPrice.toFixed(2)} • {selectedOrder.postToName} • {selectedOrder.postToPostcode}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Reason</label>
                <Select value={reason} onValueChange={(v) => v && setReason(v)}>
                  <SelectTrigger className="h-8 text-sm w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Refund Amount (£)</label>
                <Input
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder={selectedOrder ? selectedOrder.totalPrice.toFixed(2) : '0.00'}
                  className="h-8 text-sm w-28 font-mono"
                  type="number"
                  step="0.01"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details..."
                className="h-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Return tracking #</label>
                <Input
                  value={returnTrackingNumber}
                  onChange={(e) => setReturnTrackingNumber(e.target.value)}
                  placeholder="e.g. 1234567890"
                  className="h-8 text-sm w-40 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Responsible department</label>
                <Select value={responsibleDepartment} onValueChange={(v) => v && setResponsibleDepartment(v as Department)}>
                  <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select dept" /></SelectTrigger>
                  <SelectContent>
                    {(['assembler', 'packing'] as Department[]).map((k) => (
                      <SelectItem key={k} value={k}>{DEPARTMENT_CONFIG[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Responsible user</label>
                <Select value={responsibleUserId} onValueChange={(v) => v && setResponsibleUserId(v)}>
                  <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select user" /></SelectTrigger>
                  <SelectContent>
                    {users.filter((u) => !responsibleDepartment || u.departments?.includes(responsibleDepartment) || u.department === responsibleDepartment).map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {ebayReturnId && (
              <div>
                <label className="text-xs text-slate-500 block mb-1">eBay Return ID</label>
                <Input
                  value={ebayReturnId}
                  onChange={(e) => setEbayReturnId(e.target.value)}
                  placeholder="e.g. 5321625172"
                  className="h-8 text-sm w-48 font-mono"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Images</label>
              <ImageUpload
                bucket={RETURN_IMAGE_BUCKET}
                recordId={newReturnId || genId()}
                images={returnImageUrls}
                onChange={setReturnImageUrls}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" onClick={() => handleSubmit()}>Log Return</Button>
              <Button
                size="sm"
                variant="outline"
                className="text-blue-700 border-blue-300 hover:bg-blue-50"
                onClick={() => handleSubmit({ generateLabel: true })}
                disabled={!selectedOrderId}
                title={selectedOrderId ? 'Log the return and issue a DPD return label' : 'Select an order first'}
              >
                <Truck className="h-3.5 w-3.5 mr-1" />
                Log Return + Generate Label
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search returns..." className="pl-8 h-8 text-sm" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={(v) => v && setPlatformFilter(v)}>
          <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Platforms</SelectItem>
            <SelectItem value="ebay">eBay</SelectItem>
            <SelectItem value="amazon">Amazon</SelectItem>
            <SelectItem value="backmarket">Back Market</SelectItem>
            <SelectItem value="onbuy">OnBuy</SelectItem>
            <SelectItem value="temu">Temu</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400">Total refunded: <strong className="text-green-700">£{totalRefunded.toFixed(2)}</strong></span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filteredReturns.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <PackageOpen className="h-10 w-10 mx-auto mb-2 text-slate-200" />
              <p>No returns found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Sale #</TableHead>
                  <TableHead className="text-xs">eBay Order #</TableHead>
                  <TableHead className="text-xs">eBay User</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                  <TableHead className="text-xs">Return Tracking</TableHead>
                  <TableHead className="text-xs">Refund</TableHead>
                  <TableHead className="text-xs">Responsible</TableHead>
                  <TableHead className="text-xs">Images</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret) => {
                  const listing = returnListing(ret);
                  // Replace/Swap/Refund fire eBay actions (and DPD/local for manual).
                  // For Amazon/other marketplaces there's no action API, so hide them
                  // rather than have a Refund button that silently does nothing.
                  const canMarketplaceAction = !ret.platform || ret.platform === 'ebay' || ret.platform === 'manual';
                  return (
                  <TableRow key={ret.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setDetailReturn(ret)}>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(ret.returnedAt).toLocaleDateString('en-GB')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{ret.salesRecordNumber}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-500">{ret.orderNumber || '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">{ret.buyerUsername || '—'}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex items-center gap-2">
                        {listing.thumb ? (
                          <img src={listing.thumb} alt="" className="h-8 w-8 rounded object-cover border border-slate-200 bg-slate-100 shrink-0" />
                        ) : (
                          <div className="h-8 w-8 rounded border border-slate-200 bg-slate-50 shrink-0" />
                        )}
                        {listing.listingUrl ? (
                          <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-blue-600 hover:underline truncate flex items-center gap-0.5">
                            <span className="truncate">{ret.itemTitle}</span><ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs truncate">{ret.itemTitle}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {ret.reason
                        ? <Badge variant="outline" className="text-xs font-semibold bg-amber-50 text-amber-800 border-amber-300 whitespace-normal h-auto min-h-5 py-0.5 leading-tight text-center max-w-[160px]">{prettyReason(ret.reason)}</Badge>
                        : <span className="text-xs text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{ret.returnTrackingNumber || '—'}</TableCell>
                    <TableCell className="text-xs font-medium">
                      {ret.refundAmount ? `£${ret.refundAmount.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {ret.responsibleDepartment ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="outline" className={`text-xs w-fit ${DEPARTMENT_CONFIG[ret.responsibleDepartment]?.color || 'bg-slate-100 text-slate-600'}`}>
                            {DEPARTMENT_CONFIG[ret.responsibleDepartment]?.label || ret.responsibleDepartment}
                          </Badge>
                          {ret.responsibleUserName && (
                            <span className="text-xs text-slate-500">{ret.responsibleUserName}</span>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {ret.imageUrls && ret.imageUrls.length > 0 ? (
                        <div className="flex -space-x-1.5">
                          {ret.imageUrls.slice(0, 3).map((url, idx) => (
                            <img
                              key={idx}
                              src={url}
                              alt=""
                              className="h-7 w-7 rounded-full border border-white object-cover bg-slate-100"
                            />
                          ))}
                          {ret.imageUrls.length > 3 && (
                            <span className="h-7 w-7 rounded-full border border-white bg-slate-200 text-[10px] flex items-center justify-center text-slate-600">
                              +{ret.imageUrls.length - 3}
                            </span>
                          )}
                        </div>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={`text-xs ${STATUS_CONFIG[ret.status].color} w-fit`}>
                          {STATUS_CONFIG[ret.status].label}
                        </Badge>
                        {ret.platform && ret.platform !== 'manual' && (
                          <Badge variant="outline" className="text-xs w-fit bg-slate-100 text-slate-600 border-slate-300 capitalize">
                            {ret.platform}
                          </Badge>
                        )}
                        {listing.caseNumber && (
                          listing.caseUrl ? (
                            <a href={listing.caseUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              <Badge variant="outline" className="text-xs w-fit bg-slate-100 text-slate-600 border-slate-300 hover:border-blue-400 flex items-center gap-0.5">
                                Case #{listing.caseNumber}<ExternalLink className="h-2.5 w-2.5" />
                              </Badge>
                            </a>
                          ) : (
                            <Badge variant="outline" className="text-xs w-fit bg-slate-100 text-slate-600 border-slate-300">
                              RMA {listing.caseNumber}
                            </Badge>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 flex-wrap">
                        {ret.orderId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs px-2 text-blue-600 border-blue-300 hover:bg-blue-50"
                            onClick={() => {
                              // Returns can reference orders that aren't in the local
                              // store yet (auto-created from platform syncs while the
                              // orders backfill is still running).
                              if (!orders.some((o) => o.id === ret.orderId)) {
                                toast.info('Order not synced locally yet — try again after the next order sync.');
                                return;
                              }
                              setViewOrderId(ret.orderId);
                            }}
                          >
                            <Eye className="h-3 w-3 mr-1" />Order
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 text-slate-600 border-slate-300"
                          onClick={() => openEdit(ret)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                        {(ret.status === 'pending' || ret.status === 'swap') && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                            disabled={!isEbayActionAvailable(ret, 'SELLER_MARK_AS_RECEIVED', ebayReturns)}
                            title={!isEbayActionAvailable(ret, 'SELLER_MARK_AS_RECEIVED', ebayReturns) ? 'Not available on eBay right now' : undefined}
                            onClick={() => { setReceiveReturn(ret); setReceiveNotes(ret.receivedNotes || ''); }}>
                            <Truck className="h-3 w-3 mr-1" />Received
                          </Button>
                        )}
                        {(ret.status === 'pending' || ret.status === 'swap') && !ret.returnTrackingNumber && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-blue-700 border-blue-300"
                            onClick={() => {
                              const orig = orders.find((o) => o.id === ret.orderId);
                              if (!orig) { toast.info('Order not synced locally yet — a DPD label needs the customer address from the order.'); return; }
                              setLabelTarget({ order: orig, returnId: ret.id });
                            }}>
                            <Truck className="h-3 w-3 mr-1" />Label
                          </Button>
                        )}
                        {canMarketplaceAction && (<>
                        {(ret.status === 'pending' || ret.status === 'received') && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-purple-700 border-purple-300"
                            disabled={!isEbayActionAvailable(ret, 'SELLER_MARK_REPLACEMENT_SHIPPED', ebayReturns)}
                            title={!isEbayActionAvailable(ret, 'SELLER_MARK_REPLACEMENT_SHIPPED', ebayReturns) ? 'Not available on eBay right now' : undefined}
                            onClick={() => {
                              const orig = orders.find(o => o.id === ret.orderId);
                              setReplaceMode('replacement');
                              setReplaceReturn(ret);
                              setReplacementItemTitle(orig?.itemTitle || ret.itemTitle);
                            }}>
                            <Replace className="h-3 w-3 mr-1" />Replace
                          </Button>
                        )}
                        {ret.status === 'pending' && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-orange-700 border-orange-300"
                            disabled={!isEbayActionAvailable(ret, 'SELLER_MARK_REPLACEMENT_SHIPPED', ebayReturns)}
                            title={!isEbayActionAvailable(ret, 'SELLER_MARK_REPLACEMENT_SHIPPED', ebayReturns) ? 'Not available on eBay right now' : undefined}
                            onClick={() => {
                              const orig = orders.find(o => o.id === ret.orderId);
                              setReplaceMode('swap');
                              setReplaceReturn(ret);
                              setReplacementItemTitle(orig?.itemTitle || ret.itemTitle);
                            }}>
                            <ArrowLeftRight className="h-3 w-3 mr-1" />Swap
                          </Button>
                        )}
                        {(ret.status === 'pending' || ret.status === 'received') && (
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-green-700 border-green-300"
                            disabled={!isEbayActionAvailable(ret, 'SELLER_ISSUE_REFUND', ebayReturns)}
                            title={!isEbayActionAvailable(ret, 'SELLER_ISSUE_REFUND', ebayReturns) ? 'Not available on eBay right now' : undefined}
                            onClick={() => {
                              setRefundReturn(ret);
                              setRefundAmountConfirm(ret.refundAmount?.toFixed(2) ?? '');
                            }}>
                            <CheckCircle className="h-3 w-3 mr-1" />Refund
                          </Button>
                        )}
                        </>)}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Replacement dialog */}
      {replaceReturn && (() => {
        const origOrder = orders.find(o => o.id === replaceReturn.orderId);
        return (
          <Dialog open onOpenChange={(open) => { if (!open && !swapSubmitting) closeReplaceDialog(); }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {replaceMode === 'swap' ? 'Create Swap' : 'Create Replacement'} — #{replaceReturn.salesRecordNumber}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {replaceMode === 'swap' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800">
                    The replacement is dispatched <strong>before</strong> the faulty item comes back.
                    A DPD collection or return label is created for the faulty item straight away.
                  </div>
                )}
                {/* Original order details */}
                {origOrder && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-slate-700">Original Order</p>
                    <p className="font-medium">{origOrder.itemTitle}</p>
                    {origOrder.variation && (
                      <p className="text-amber-700 font-medium">Variation: {origOrder.variation}</p>
                    )}
                    <p className="text-slate-500">{origOrder.postToName} · {origOrder.postToPostcode}</p>
                    <p className="text-slate-500">SKU: {origOrder.customLabel || '—'} · Qty: {origOrder.quantity}</p>
                    <p className="text-slate-500">Paid: £{origOrder.totalPrice.toFixed(2)} · Carrier: {origOrder.deliveryCarrier || '—'}</p>
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Replacement item title</label>
                  <Input
                    value={replacementItemTitle}
                    onChange={(e) => setReplacementItemTitle(e.target.value)}
                    placeholder="Item to send as replacement"
                  />
                </div>
                <div className="flex gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">Quantity</label>
                    <Input
                      type="number"
                      min={1}
                      value={replacementQty}
                      onChange={(e) => setReplacementQty(e.target.value)}
                      className="w-24"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Notes</label>
                  <Input
                    value={replacementNotes}
                    onChange={(e) => setReplacementNotes(e.target.value)}
                    placeholder="Optional notes..."
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Replacement Images</label>
                  <ImageUpload
                    bucket={REPLACEMENT_IMAGE_BUCKET}
                    recordId={replaceReturn.id}
                    images={replacementImageUrls}
                    onChange={setReplacementImageUrls}
                  />
                </div>
                {replaceMode === 'swap' && (
                  <div className="border-t pt-3 space-y-3">
                    <p className="text-xs font-semibold text-slate-600">Faulty item return via DPD</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setSwapMethod('collection')}
                        className={`rounded-md border text-xs font-medium py-2 px-2 text-left ${swapMethod === 'collection' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                        <span className="block font-semibold">DPD Collection</span>
                        <span className={`block mt-0.5 ${swapMethod === 'collection' ? 'text-orange-100' : 'text-slate-400'}`}>Driver collects from the customer</span>
                      </button>
                      <button type="button" onClick={() => setSwapMethod('label')}
                        className={`rounded-md border text-xs font-medium py-2 px-2 text-left ${swapMethod === 'label' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                        <span className="block font-semibold">Return Label</span>
                        <span className={`block mt-0.5 ${swapMethod === 'label' ? 'text-orange-100' : 'text-slate-400'}`}>Customer drops off at a DPD point</span>
                      </button>
                    </div>
                    <div className="flex items-end gap-3">
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">Boxes</label>
                        <Input type="number" min={1} step={1} value={swapBoxes}
                          onChange={(e) => setSwapBoxes(e.target.value)} className="w-24" />
                      </div>
                      {swapMethod === 'label' && (
                        <button type="button" onClick={() => setSwapEmailLabel((v) => !v)}
                          className={`rounded-md border text-xs font-medium py-2 px-3 ${swapEmailLabel ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                          Email label to customer
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeReplaceDialog} disabled={swapSubmitting}>Cancel</Button>
                <Button onClick={handleCreateReplacement} disabled={swapSubmitting}
                  className={replaceMode === 'swap' ? 'bg-orange-600 hover:bg-orange-700' : undefined}>
                  {swapSubmitting
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Booking DPD…</>
                    : replaceMode === 'swap' ? 'Create Swap & Book DPD' : 'Create Replacement Order'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Receive dialog — with comments */}
      {receiveReturn && (
        <Dialog open onOpenChange={(open) => { if (!open) setReceiveReturn(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark as Received — #{receiveReturn.salesRecordNumber}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                <p className="font-medium">{receiveReturn.itemTitle}</p>
                <p className="text-slate-500 mt-0.5">Reason: {prettyReason(receiveReturn.reason)}</p>
                {receiveReturn.status === 'swap' && (
                  <p className="text-orange-700 mt-1 font-medium">
                    Swap — receiving the faulty item back completes this swap.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Receipt comments (condition, notes…)</label>
                <textarea
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="e.g. Item received, box damaged but unit OK"
                  rows={3}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReceiveReturn(null)}>Cancel</Button>
              <Button onClick={async () => {
                const ok = await performEbayAction(receiveReturn, 'SELLER_MARK_AS_RECEIVED', { comments: { content: receiveNotes.trim() } });
                if (!ok) return;
                if (receiveReturn.status === 'swap') {
                  // Faulty item is back — the swap is complete, close it out as a replacement.
                  updateReturn(receiveReturn.id, { status: 'replacement', receivedNotes: receiveNotes.trim() || undefined });
                  toast.success('Faulty item received — swap complete and updated on eBay');
                } else {
                  updateReturn(receiveReturn.id, { status: 'received', receivedNotes: receiveNotes.trim() || undefined });
                  toast.success('Return marked as received and updated on eBay');
                }
                setReceiveReturn(null);
              }}>
                Confirm Received
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Refund confirm dialog — shows refund amount */}
      {refundReturn && (
        <Dialog open onOpenChange={(open) => { if (!open) setRefundReturn(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirm Refund — #{refundReturn.salesRecordNumber}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                <p className="font-medium">{refundReturn.itemTitle}</p>
                <p className="text-slate-500 mt-0.5">Buyer: {refundReturn.buyerUsername}</p>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Refund amount (£)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={refundAmountConfirm}
                  onChange={(e) => setRefundAmountConfirm(e.target.value)}
                  placeholder="0.00"
                  className="font-mono w-36"
                />
                {refundReturn.refundAmount && (
                  <p className="text-xs text-slate-400 mt-1">Originally logged: £{refundReturn.refundAmount.toFixed(2)}</p>
                )}
              </div>
              {refundAmountConfirm && (
                <p className="text-sm font-semibold text-green-700">
                  Issuing refund of £{parseFloat(refundAmountConfirm || '0').toFixed(2)}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRefundReturn(null)}>Cancel</Button>
              <Button className="bg-green-600 hover:bg-green-700" onClick={async () => {
                const amount = parseFloat(refundAmountConfirm);
                const refundAmount = isNaN(amount) ? refundReturn.refundAmount ?? 0 : amount;
                const currency = 'GBP';
                const ok = await performEbayAction(refundReturn, 'SELLER_ISSUE_REFUND', { refundAmount: { value: refundAmount, currency }, comments: { content: refundReturn.notes } });
                if (!ok) return;
                updateReturn(refundReturn.id, {
                  status: 'refunded',
                  refundAmount,
                  processedByUserId: currentUser?.id,
                  processedByUserName: currentUser?.name,
                });
                processReturn(refundReturn.id, 'refund', currentUser?.id || '', currentUser?.name || '');
                toast.success(`Refund of £${refundAmount.toFixed(2)} issued on eBay and recorded`);
                setRefundReturn(null);
              }}>
                Issue Refund
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit return dialog — editable in any status */}
      {editReturn && (
        <Dialog open onOpenChange={(open) => { if (!open) setEditReturn(null); }}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Return — #{editReturn.salesRecordNumber}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
                <p className="font-medium">{editReturn.itemTitle}</p>
                <p className="text-slate-500 mt-0.5">Buyer: {editReturn.buyerUsername}</p>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Status</label>
                <Select value={editStatus} onValueChange={(v) => v && setEditStatus(v as ReturnRecord['status'])}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Reason</label>
                <Select value={editReason} onValueChange={(v) => v && setEditReason(v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETURN_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Notes</label>
                <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Refund amount (£)</label>
                <Input
                  type="number" step="0.01"
                  value={editRefundAmount}
                  onChange={(e) => setEditRefundAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-8 text-sm w-32 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Return tracking #</label>
                <Input
                  value={editReturnTrackingNumber}
                  onChange={(e) => setEditReturnTrackingNumber(e.target.value)}
                  placeholder="e.g. 1234567890"
                  className="h-8 text-sm w-40 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Receipt comments</label>
                <textarea
                  value={editReceivedNotes}
                  onChange={(e) => setEditReceivedNotes(e.target.value)}
                  placeholder="Condition / received notes"
                  rows={2}
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">eBay Return ID</label>
                <Input
                  value={editEbayReturnId}
                  onChange={(e) => setEditEbayReturnId(e.target.value)}
                  placeholder="e.g. 5321625172"
                  className="h-8 text-sm w-48 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Images</label>
                <ImageUpload
                  bucket={RETURN_IMAGE_BUCKET}
                  recordId={editReturn.id}
                  images={editImageUrls}
                  onChange={setEditImageUrls}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Responsible department</label>
                  <Select value={editResponsibleDepartment} onValueChange={(v) => v && setEditResponsibleDepartment(v as Department)}>
                    <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select dept" /></SelectTrigger>
                    <SelectContent>
                      {(['assembler', 'packing'] as Department[]).map((k) => (
                        <SelectItem key={k} value={k}>{DEPARTMENT_CONFIG[k].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Responsible user</label>
                  <Select value={editResponsibleUserId} onValueChange={(v) => v && setEditResponsibleUserId(v)}>
                    <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder="Select user" /></SelectTrigger>
                    <SelectContent>
                      {users.filter((u) => !editResponsibleDepartment || u.departments?.includes(editResponsibleDepartment) || u.department === editResponsibleDepartment).map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditReturn(null)}>Cancel</Button>
              <Button onClick={() => {
                const refundAmount = editRefundAmount ? parseFloat(editRefundAmount) : undefined;
                updateReturn(editReturn.id, {
                  status: editStatus,
                  reason: editReason,
                  notes: editNotes,
                  refundAmount: refundAmount ? refundAmount : undefined,
                  returnTrackingNumber: editReturnTrackingNumber.trim() || undefined,
                  receivedNotes: editReceivedNotes.trim() || undefined,
                  responsibleDepartment: editResponsibleDepartment || undefined,
                  responsibleUserId: editResponsibleUserId || undefined,
                  responsibleUserName: editResponsibleUserId ? users.find((u) => u.id === editResponsibleUserId)?.name : undefined,
                  imageUrls: editImageUrls.length > 0 ? editImageUrls : undefined,
                  ebayReturnId: editEbayReturnId.trim() || undefined,
                  platform: (editEbayReturnId.trim() ? 'ebay' : editReturn.platform === 'ebay' ? 'manual' : editReturn.platform) as ReturnRecord['platform'],
                });
                if (editStatus === 'refunded' || editStatus === 'replacement' || editStatus === 'swap') {
                  const resolution = editStatus === 'refunded' ? 'refund' : editStatus === 'swap' ? 'swap' : 'replacement';
                  processReturn(editReturn.id, resolution, currentUser?.id || '', currentUser?.name || '');
                }
                toast.success('Return updated');
                setEditReturn(null);
              }}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Return details pane — opens on row / listing / case click */}
      {detailReturn && (() => {
        const ret = detailReturn;
        const listing = returnListing(ret);
        const canMarketplaceAction = !ret.platform || ret.platform === 'ebay' || ret.platform === 'manual';
        const orderExists = orders.some((o) => o.id === ret.orderId);
        const close = () => setDetailReturn(null);
        return (
          <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  Return #{ret.salesRecordNumber}
                  <Badge variant="outline" className={`text-xs ${STATUS_CONFIG[ret.status].color}`}>{STATUS_CONFIG[ret.status].label}</Badge>
                  {ret.platform && ret.platform !== 'manual' && (
                    <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-300 capitalize">{ret.platform}</Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1 text-sm">
                {/* Item */}
                <div className="flex items-start gap-3">
                  {listing.thumb
                    ? <img src={listing.thumb} alt="" className="h-14 w-14 rounded object-cover border border-slate-200 bg-slate-100 shrink-0" />
                    : <div className="h-14 w-14 rounded border border-slate-200 bg-slate-50 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 leading-snug">{ret.itemTitle}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                      {listing.listingUrl && (
                        <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-0.5">
                          View listing <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {listing.caseNumber && (
                        listing.caseUrl
                          ? <a href={listing.caseUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-0.5">Case #{listing.caseNumber} <ExternalLink className="h-3 w-3" /></a>
                          : <span className="text-slate-500">RMA {listing.caseNumber}</span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Facts */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div><span className="text-slate-400">Buyer</span><p className="font-medium text-slate-700">{ret.buyerUsername || '—'}</p></div>
                  <div><span className="text-slate-400">Order #</span><p className="font-mono text-slate-700">{ret.orderNumber || '—'}</p></div>
                  <div><span className="text-slate-400">Opened</span><p className="text-slate-700">{new Date(ret.returnedAt).toLocaleDateString('en-GB')}</p></div>
                  <div><span className="text-slate-400">Refund</span><p className="font-medium text-slate-700">{ret.refundAmount ? `£${ret.refundAmount.toFixed(2)}` : '—'}</p></div>
                  {ret.returnTrackingNumber && <div className="col-span-2"><span className="text-slate-400">Return tracking</span><p className="font-mono text-slate-700">{ret.returnTrackingNumber}</p></div>}
                </div>
                {/* Reason */}
                <div>
                  <span className="text-xs text-slate-400">Reason</span>
                  <div className="mt-1"><Badge variant="outline" className="text-xs font-semibold bg-amber-50 text-amber-800 border-amber-300 whitespace-normal h-auto min-h-5 py-0.5 leading-tight text-center">{prettyReason(ret.reason) || '—'}</Badge></div>
                </div>
                {ret.notes && <div><span className="text-xs text-slate-400">Notes</span><p className="text-xs text-slate-600 mt-0.5 whitespace-pre-wrap">{ret.notes}</p></div>}
                {!canMarketplaceAction && (
                  <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                    Replace / Swap / Refund aren&apos;t available for {ret.platform} returns — those are handled in the {ret.platform === 'amazon' ? 'Amazon Seller Central' : 'marketplace'} console.
                  </p>
                )}
              </div>
              <DialogFooter className="flex-wrap gap-2 sm:justify-start">
                {ret.orderId && (
                  <Button size="sm" variant="outline" className="text-blue-600 border-blue-300"
                    onClick={() => { if (!orderExists) { toast.info('Order not synced locally yet.'); return; } setViewOrderId(ret.orderId); close(); }}>
                    <Eye className="h-3 w-3 mr-1" />Order
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { openEdit(ret); close(); }}>
                  <Pencil className="h-3 w-3 mr-1" />Edit
                </Button>
                {(ret.status === 'pending' || ret.status === 'swap') && (
                  <Button size="sm" variant="outline" onClick={() => { setReceiveReturn(ret); setReceiveNotes(ret.receivedNotes || ''); close(); }}>
                    <Truck className="h-3 w-3 mr-1" />Received
                  </Button>
                )}
                {canMarketplaceAction && (ret.status === 'pending' || ret.status === 'received') && (
                  <Button size="sm" variant="outline" className="text-purple-700 border-purple-300"
                    onClick={() => { const orig = orders.find(o => o.id === ret.orderId); setReplaceMode('replacement'); setReplaceReturn(ret); setReplacementItemTitle(orig?.itemTitle || ret.itemTitle); close(); }}>
                    <Replace className="h-3 w-3 mr-1" />Replace
                  </Button>
                )}
                {canMarketplaceAction && ret.status === 'pending' && (
                  <Button size="sm" variant="outline" className="text-orange-700 border-orange-300"
                    onClick={() => { const orig = orders.find(o => o.id === ret.orderId); setReplaceMode('swap'); setReplaceReturn(ret); setReplacementItemTitle(orig?.itemTitle || ret.itemTitle); close(); }}>
                    <ArrowLeftRight className="h-3 w-3 mr-1" />Swap
                  </Button>
                )}
                {canMarketplaceAction && (ret.status === 'pending' || ret.status === 'received') && (
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300"
                    onClick={() => { setRefundReturn(ret); setRefundAmountConfirm(ret.refundAmount?.toFixed(2) ?? ''); close(); }}>
                    <CheckCircle className="h-3 w-3 mr-1" />Refund
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Linked original order view */}
      {(() => {
        const viewOrder = viewOrderId ? orders.find((o) => o.id === viewOrderId) : undefined;
        return viewOrder ? (
          <OrderDetailDialog
            order={viewOrder}
            onClose={() => setViewOrderId(null)}
          />
        ) : null;
      })()}

      {/* DPD return label for a just-logged / existing return */}
      {labelTarget && (
        <ReturnLabelDialog
          order={labelTarget.order}
          returnId={labelTarget.returnId}
          onClose={() => setLabelTarget(null)}
        />
      )}
    </div>
  );
}
