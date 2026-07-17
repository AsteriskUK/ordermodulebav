import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { Order, OrderNote, OrderStatus, Batch, DeliveryCarrier, DeliveryType, AppUser, EodEvent, ReturnRecord, ReplacementItem, MissingItemRecord, Department, AttendanceRecord, LeaveRequest, LeaveBalance, TicketRecord, TicketActivity, InventoryPart, StockUnit, StockLevel, GoodsReceipt, Build, BuildLine, BuildSwap, AccessConfig } from './types';
import { syncAttendance, syncLeaveRequest, syncLeaveBalance, syncOrder, syncBatch, syncUser, deleteUserFromSupabase, syncReturn, syncTicket, deleteTicketFromSupabase, syncMissingItem, syncInventoryPart, syncStockUnit, syncStockLevel, syncGoodsReceipt, syncBuild, softDeleteOrderInSupabase, hardDeleteOrderFromSupabase } from './supabase-store';
import { buildSku, INVENTORY_CATEGORY_MAP } from './inventory-config';
import { allPackItemsConfirmed } from './inventory-build';

// Generate proper UUID v4 for PostgreSQL compatibility
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// When an order ships from the warehouse, upload its tracking to eBay as a
// shipping fulfilment. Until dispatch the buyer only has the tracking number
// via an order message (sent at label booking) — this is the moment it goes
// live on eBay. Fire-and-forget; the endpoint is idempotent (skips orders that
// already have a fulfilment), and a session-level set avoids repeat calls.
const fulfilmentPushed = new Set<string>();
function pushMarketplaceFulfillment(order: Order): void {
  if (typeof window === 'undefined') return;
  if (!order.trackingNumber || !order.orderNumber) return;
  // eBay order ids look like 12-34567-89012 (or the batch says eBay).
  const isEbay = /^\d{2}-\d{5}-\d{5}$/.test(order.orderNumber) || order.batchId?.startsWith('ebay-');
  if (!isEbay || fulfilmentPushed.has(order.orderNumber)) return;
  fulfilmentPushed.add(order.orderNumber);
  fetch('/api/ebay/orders/fulfillment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber: order.orderNumber, trackingNumber: order.trackingNumber, carrier: order.deliveryCarrier }),
  }).then(async (res) => {
    if (!res.ok) {
      fulfilmentPushed.delete(order.orderNumber); // allow a retry on the next shipped move
      console.warn('[fulfilment] eBay tracking upload failed', order.salesRecordNumber, (await res.text()).slice(0, 200));
    }
  }).catch((e) => {
    fulfilmentPushed.delete(order.orderNumber);
    console.warn('[fulfilment] eBay tracking upload error', order.salesRecordNumber, e);
  });
}

// Advisory assembly locks auto-expire so a closed tab / abandoned build doesn't
// block the order forever.
export const ASSEMBLY_LOCK_TTL_MS = 30 * 60 * 1000;

/** The assembler holding a fresh lock on this order, or null if free/expired. */
export function assemblyLockHolder(order: { lockedById?: string; lockedByName?: string; lockedAt?: string }): { id?: string; name?: string } | null {
  if (!order.lockedById || !order.lockedAt) return null;
  if (Date.now() - new Date(order.lockedAt).getTime() > ASSEMBLY_LOCK_TTL_MS) return null;
  return { id: order.lockedById, name: order.lockedByName };
}

export interface EmailConfig {
  enabled: boolean;
  recipientEmail: string;
  /** SMTP settings stored here — actual sending requires the /api/send-eod server route */
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  autoSendAt8pm: boolean;
}

function idbStorage() {
  return createJSONStorage(() => ({
    getItem: async (name: string) => {
      const val = await get(name);
      return val ?? null;
    },
    setItem: async (name: string, value: string) => {
      await idbSet(name, value);
    },
    removeItem: async (name: string) => {
      await del(name);
    },
  }));
}

interface OrderStore {
  orders: Order[];
  batches: Batch[];
  eodEvents: EodEvent[];
  returns: ReturnRecord[];
  users: AppUser[];
  currentUserId: string | null;
  emailConfig: EmailConfig;
  accessControl: AccessConfig | null;
  setAccessControl: (config: AccessConfig | null) => void;
  addOrders: (orders: Order[], batch: Batch) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrderComment: (orderId: string, comment: string) => void;
  addOrderNote: (orderId: string, note: Omit<OrderNote, 'id' | 'createdAt'>) => void;
  deleteOrderNote: (orderId: string, noteId: string) => void;
  updateOrderTracking: (orderId: string, trackingNumber: string) => void;
  attachSecurityBarcode: (orderId: string, barcode: string) => void;   // link preprinted label to order
  softCancelOrder: (orderId: string, reason?: string) => void;         // cancel (recoverable) + raise urgent Comms ticket
  acquireAssemblyLock: (orderId: string, force?: boolean) => boolean;  // lock a build to the current assembler
  releaseAssemblyLock: (orderId: string) => void;
  setOrderPicked: (orderId: string, picked: boolean) => void;          // order-picker: parts gathered
  setOrderCleaned: (orderId: string, cleaned: boolean) => void;          // cleaning stage hand-off
  setOrderVinylApplied: (orderId: string, applied: boolean) => void;    // vinyl film hand-off
  togglePackChecklistItem: (orderId: string, key: string) => void;      // packing: tick an outstanding accessory/monitor
  updateOrderCarrier: (orderId: string, carrier: DeliveryCarrier, deliveryType: DeliveryType) => void;
  updateOrderLabelQty: (orderId: string, qty: number) => void;
  updateOrderCategory: (orderId: string, category: string) => void;
  updateOrderPriority: (orderId: string, priority: number) => void;
  updateOrderNumberOfBoxes: (orderId: string, numberOfBoxes: number) => void;
  updateOrderExtendedLiability: (orderId: string, extendedLiability: boolean) => void;
  updateOrderDeliveryService: (orderId: string, deliveryService: string) => void;
  saveOrderLabels: (orderId: string, carrier: string, labels: string[]) => void;
  bulkUpdateStatus: (orderIds: string[], status: OrderStatus) => void;
  deleteOrder: (orderId: string) => void;
  restoreOrder: (orderId: string) => void;
  purgeOrphanOrders: () => void;
  getDeletedOrders: () => Order[];
  permanentDeleteOrder: (orderId: string) => void;
  deleteBatch: (batchId: string) => void;
  addUser: (user: AppUser) => void;
  updateUser: (userId: string, updates: Partial<AppUser>) => void;
  deleteUser: (userId: string) => void;
  setCurrentUser: (userId: string | null) => void;
  setEmailConfig: (config: Partial<EmailConfig>) => void;
  clearEodEvents: () => void;
  addReturn: (ret: ReturnRecord) => void;
  updateReturn: (returnId: string, updates: Partial<ReturnRecord>) => void;
  processReturn: (returnId: string, resolution: 'refund' | 'replacement' | 'swap', processedByUserId: string, processedByUserName: string) => void;
  addReplacementItem: (returnId: string, item: ReplacementItem) => void;
  createReplacementOrder: (returnId: string, overrides?: Partial<Order>) => Order;
  // Missing Items
  missingItems: MissingItemRecord[];
  addMissingItem: (record: MissingItemRecord) => void;
  updateMissingItem: (id: string, updates: Partial<MissingItemRecord>) => void;
  createMissingItemOrder: (missingItemId: string) => Order;
  // Support Tickets
  tickets: TicketRecord[];
  addTicket: (ticket: TicketRecord) => void;
  updateTicket: (id: string, updates: Partial<TicketRecord>, activity?: Omit<TicketActivity, 'at'>) => void;
  editTicketActivity: (ticketId: string, activityId: string, text: string) => void;   // edit a note/message
  deleteTicketActivity: (ticketId: string, activityId: string) => void;
  deleteTicket: (id: string) => void;
  // Inventory
  inventoryParts: InventoryPart[];
  stockUnits: StockUnit[];
  stockLevels: StockLevel[];
  goodsReceipts: GoodsReceipt[];
  upsertInventoryPart: (part: InventoryPart) => void;
  saveGoodsReceipt: (receipt: GoodsReceipt) => void;
  deleteGoodsReceipt: (id: string) => void;
  postGoodsReceipt: (receiptId: string) => void;
  updateStockUnit: (id: string, updates: Partial<StockUnit>) => void;
  // Builds (assembly) — reserve on hold, deduct at packed
  builds: Build[];
  saveBuild: (build: Build) => void;          // create/update + reserve serialized units
  cancelBuild: (buildId: string) => void;     // release the hold
  consumeBuild: (buildId: string) => void;    // deduct from stock (negative allowed)
  pickOrderComponents: (orderId: string, specs: { category: string; label: string; attributes: Record<string, string | number>; quantity: number }[]) => void;  // order picker: build lines from tapped components, deduct stock, mark picked
  recordBuildSwap: (orderId: string, swap: BuildSwap) => void;   // out→stock, in→consumed
  removeBuildSwap: (orderId: string, swapId: string) => void;    // reverse a recorded swap
  // HR Actions
  attendanceRecords: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  leaveBalances: LeaveBalance[];
  clockIn: (userId: string, notes?: string) => void;
  clockOut: (userId: string) => void;
  updateAttendance: (recordId: string, updates: Partial<AttendanceRecord>) => void;
  addLeaveRequest: (request: Omit<LeaveRequest, 'id' | 'requestedAt' | 'status'>) => void;
  approveLeave: (requestId: string, approverId: string) => void;
  rejectLeave: (requestId: string, reason: string) => void;
  cancelLeave: (requestId: string) => void;
  updateLeaveBalance: (userId: string, year: number, updates: Partial<LeaveBalance>) => void;
}

export const useOrderStore = create<OrderStore>()(
  persist(
    (set, get) => ({
      orders: [] as Order[],
      batches: [] as Batch[],
      eodEvents: [] as EodEvent[],
      returns: [] as ReturnRecord[],
      missingItems: [] as MissingItemRecord[],
      tickets: [] as TicketRecord[],
      inventoryParts: [] as InventoryPart[],
      stockUnits: [] as StockUnit[],
      stockLevels: [] as StockLevel[],
      goodsReceipts: [] as GoodsReceipt[],
      builds: [] as Build[],
      attendanceRecords: [] as AttendanceRecord[],
      leaveRequests: [] as LeaveRequest[],
      leaveBalances: [] as LeaveBalance[],
      users: [
        { id: 'admin-1', name: 'Admin', role: 'admin', roles: ['admin'], department: 'management', departments: ['management'], pin: '1234' },
      ] as AppUser[],
      currentUserId: null as string | null,
      accessControl: null as AccessConfig | null,
      emailConfig: {
        enabled: false,
        recipientEmail: '',
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
        fromAddress: '',
        autoSendAt8pm: true,
      },
      addOrders: (newOrders, batch) =>
        set((state) => {
          const incomingNums = new Set(newOrders.map((o) => o.salesRecordNumber).filter(Boolean));
          const existingByNum = new Map(state.orders.filter((o) => incomingNums.has(o.salesRecordNumber)).map((o) => [o.salesRecordNumber, o]));

          const ordersWithDefaults = newOrders.map(order => {
            const existing = existingByNum.get(order.salesRecordNumber);
            return {
              ...order,
              priority: order.priority ?? 5,
              numberOfBoxes: order.numberOfBoxes ?? 1,
              // Preserve existing team notes and label data when re-importing
              notes: existing?.notes && existing.notes.length > 0 ? existing.notes : order.notes,
              labelPrintedAt: existing?.labelPrintedAt ?? order.labelPrintedAt,
              labelCarrier: existing?.labelCarrier ?? order.labelCarrier,
              labelData: existing?.labelData ?? order.labelData,
              status: existing?.status ?? order.status,
              category: existing?.category ?? order.category,
              trackingNumber: existing?.trackingNumber ?? order.trackingNumber,
              deliveryCarrier: existing?.deliveryCarrier ?? order.deliveryCarrier,
              deliveryType: existing?.deliveryType ?? order.deliveryType,
            };
          });
          // Replace any existing order that shares a salesRecordNumber with an incoming order
          const retained = state.orders.filter((o) => !incomingNums.has(o.salesRecordNumber));
          
          // Sync to Supabase in background - batch first, then orders
          (async () => {
            try {
              await syncBatch(batch, state.currentUserId || undefined);
              // Only sync orders after batch is confirmed
              for (const order of ordersWithDefaults) {
                await syncOrder(order).catch(err => console.error('Order sync error:', err));
              }
            } catch (err) {
              console.error('Batch sync error:', err);
            }
          })();
          
          return {
            orders: [...retained, ...ordersWithDefaults],
            batches: [...state.batches, batch],
          };
        }),
      updateOrderStatus: (orderId, status) => {
        const before = get().orders.find((o) => o.id === orderId);
        // Block Packed until the packing dept has ticked every outstanding
        // accessory/monitor added during the build. Callers show the checklist.
        if (status === 'packed' && before && before.status !== 'packed' && !allPackItemsConfirmed(before, get().builds)) {
          return;
        }
        set((state) => {
          const order = state.orders.find((o) => o.id === orderId);
          if (!order) return {};
          const user = state.users.find((u) => u.id === state.currentUserId);
          const event: EodEvent = {
            orderId,
            salesRecordNumber: order.salesRecordNumber,
            itemTitle: order.itemTitle,
            fromStatus: order.status,
            toStatus: status,
            changedAt: new Date().toISOString(),
            userId: user?.id,
            userName: user?.name,
            department: user?.department,
          };
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, status } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return {
            orders: updatedOrders,
            eodEvents: [...state.eodEvents, event],
          };
        });
        // Deduct stock when the order reaches packed: consume its on-hold build.
        if (status === 'packed' && before && before.status !== 'packed') {
          const build = get().builds.find((b) => b.orderId === orderId && b.status === 'reserved');
          if (build) get().consumeBuild(build.id);
        }
        // Shipped from the warehouse → put the tracking live on eBay.
        if (status === 'shipped' && before && before.status !== 'shipped') {
          const shipped = get().orders.find((o) => o.id === orderId);
          if (shipped) pushMarketplaceFulfillment(shipped);
        }
      },
      updateOrderComment: (orderId, comment) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, comments: comment } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      addOrderNote: (orderId, note) =>
        set((state) => {
          const newNote = { ...note, id: generateUUID(), createdAt: new Date().toISOString() };
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId
              ? { ...o, notes: [...(o.notes ?? []), newNote] }
              : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      deleteOrderNote: (orderId, noteId) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, notes: (o.notes ?? []).filter((n) => n.id !== noteId) } : o
          ),
        })),
      updateOrderTracking: (orderId, trackingNumber) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, trackingNumber } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderCarrier: (orderId, carrier, deliveryType) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, deliveryCarrier: carrier, deliveryType } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      attachSecurityBarcode: (orderId, barcode) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, securityBarcode: barcode, securityBarcodeAt: new Date().toISOString() } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      softCancelOrder: (orderId, reason) => {
        const { orders, tickets, users, currentUserId, updateOrderStatus, addTicket } = get();
        const order = orders.find((o) => o.id === orderId);
        if (!order) return;
        // Soft cancel — status only, order is retained (recoverable via Recently Deleted / status change).
        updateOrderStatus(orderId, 'cancelled');
        // Raise an urgent Comms ticket so they handle the refund/buyer comms — but
        // not if one is already open for this order (avoid duplicates on re-detection).
        const dup = tickets.find((t) => t.orderId === orderId && t.category === 'cancellation' && t.status !== 'closed' && t.status !== 'resolved');
        if (dup) return;
        const user = users.find((u) => u.id === currentUserId);
        const now = new Date().toISOString();
        addTicket({
          id: generateUUID(),
          subject: `Cancellation — #${order.salesRecordNumber}`,
          body: reason?.trim() || 'Order cancelled — Comms to handle buyer refund / communication.',
          category: 'cancellation',
          status: 'open',
          priority: 'urgent',
          department: 'comms',
          orderId: order.id,
          salesRecordNumber: order.salesRecordNumber,
          orderNumber: order.orderNumber,
          buyerUsername: order.buyerUsername,
          buyerName: order.buyerName,
          itemTitle: order.itemTitle,
          contactMethod: order.buyerEmail ? 'email' : undefined,
          contactValue: order.buyerEmail || undefined,
          createdById: user?.id,
          createdByName: user?.name,
          activity: [{ at: now, byId: user?.id, byName: user?.name, type: 'create', text: reason?.trim() || 'Cancellation raised to Comms' }],
          createdAt: now,
          updatedAt: now,
        });
      },
      acquireAssemblyLock: (orderId, force = false) => {
        const { orders, users, currentUserId } = get();
        const order = orders.find((o) => o.id === orderId);
        if (!order) return false;
        const holder = assemblyLockHolder(order);
        if (!force && holder && holder.id !== currentUserId) return false; // someone else is on it
        const user = users.find((u) => u.id === currentUserId);
        const now = new Date().toISOString();
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, lockedById: currentUserId ?? undefined, lockedByName: user?.name, lockedAt: now } : o
          );
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
        return true;
      },
      releaseAssemblyLock: (orderId) => {
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, lockedById: undefined, lockedByName: undefined, lockedAt: undefined } : o
          );
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
      },
      setOrderPicked: (orderId, picked) => {
        const user = get().users.find((u) => u.id === get().currentUserId);
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId
              ? { ...o,
                  pickedAt: picked ? new Date().toISOString() : undefined,
                  pickedById: picked ? user?.id : undefined,
                  pickedByName: picked ? user?.name : undefined }
              : o
          );
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
      },
      setOrderCleaned: (orderId, cleaned) => {
        const user = get().users.find((u) => u.id === get().currentUserId);
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId
              ? { ...o,
                  cleanedAt: cleaned ? new Date().toISOString() : undefined,
                  cleanedById: cleaned ? user?.id : undefined,
                  cleanedByName: cleaned ? user?.name : undefined }
              : o
          );
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
      },
      setOrderVinylApplied: (orderId, applied) => {
        const user = get().users.find((u) => u.id === get().currentUserId);
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId
              ? { ...o,
                  vinylAppliedAt: applied ? new Date().toISOString() : undefined,
                  vinylAppliedById: applied ? user?.id : undefined,
                  vinylAppliedByName: applied ? user?.name : undefined }
              : o
          );
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
      },
      togglePackChecklistItem: (orderId, key) => {
        set((state) => {
          const updatedOrders = state.orders.map((o) => {
            if (o.id !== orderId) return o;
            const checklist = { ...(o.packChecklist ?? {}) };
            checklist[key] = !checklist[key];
            return { ...o, packChecklist: checklist };
          });
          const updated = updatedOrders.find((o) => o.id === orderId);
          if (updated) syncOrder(updated).catch(console.error);
          return { orders: updatedOrders };
        });
      },
      updateOrderLabelQty: (orderId, qty) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, labelQty: qty } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderCategory: (orderId, category) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, category } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderPriority: (orderId, priority) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, priority } : o
          );
          
          // If priority is set to 1 (highest), move order to top of queue
          if (priority === 1) {
            const targetOrder = updatedOrders.find(o => o.id === orderId);
            if (targetOrder) {
              // Remove the order from its current position
              const otherOrders = updatedOrders.filter(o => o.id !== orderId);
              // Add it to the beginning of the array
              const reorderedOrders = [targetOrder, ...otherOrders];
              syncOrder(targetOrder).catch(console.error);
              return { orders: reorderedOrders };
            }
          }
          
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderNumberOfBoxes: (orderId, numberOfBoxes) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, numberOfBoxes } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderExtendedLiability: (orderId, extendedLiability) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, extendedLiability } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      updateOrderDeliveryService: (orderId, deliveryService) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId ? { ...o, deliveryService } : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      saveOrderLabels: (orderId, carrier, labels) =>
        set((state) => {
          const updatedOrders = state.orders.map((o) =>
            o.id === orderId
              ? { ...o, labelPrintedAt: new Date().toISOString(), labelCarrier: carrier, labelData: labels }
              : o
          );
          const updatedOrder = updatedOrders.find(o => o.id === orderId);
          if (updatedOrder) syncOrder(updatedOrder).catch(console.error);
          return { orders: updatedOrders };
        }),
      bulkUpdateStatus: (orderIds, status) =>
        set((state) => {
          const now = new Date().toISOString();
          const user = state.users.find((u) => u.id === state.currentUserId);
          const newEvents: EodEvent[] = orderIds
            .map((id) => state.orders.find((o) => o.id === id))
            .filter((o): o is Order => !!o)
            .map((o) => ({
              orderId: o.id,
              salesRecordNumber: o.salesRecordNumber,
              itemTitle: o.itemTitle,
              fromStatus: o.status,
              toStatus: status,
              changedAt: now,
              userId: user?.id,
              userName: user?.name,
              department: user?.department,
            }));
          const updatedOrders = state.orders.map((o) =>
            orderIds.includes(o.id) ? { ...o, status } : o
          );
          // Sync all updated orders to Supabase
          updatedOrders.filter(o => orderIds.includes(o.id)).forEach(o => {
            syncOrder(o).catch(console.error);
            // Shipped from the warehouse → put the tracking live on eBay.
            if (status === 'shipped') pushMarketplaceFulfillment(o);
          });
          return {
            orders: updatedOrders,
            eodEvents: [...state.eodEvents, ...newEvents],
          };
        }),
      purgeOrphanOrders: () =>
        set((state) => {
          // Step 1: remove ghost sub-rows (no address AND no postcode)
          const withAddress = state.orders.filter((o) =>
            (o.postToAddress1 && o.postToAddress1.trim() !== '') ||
            (o.postToPostcode && o.postToPostcode.trim() !== '')
          );
          // Step 2: deduplicate by salesRecordNumber — keep the row with the longest itemTitle
          // (merged rows from the new mapper have combined titles; old sub-rows have partial titles)
          const seen = new Map<string, typeof withAddress[number]>();
          for (const o of withAddress) {
            const key = o.salesRecordNumber || o.id;
            const existing = seen.get(key);
            if (!existing || (o.itemTitle?.length ?? 0) > (existing.itemTitle?.length ?? 0)) {
              seen.set(key, o);
            }
          }
          return { orders: Array.from(seen.values()) };
        }),
      deleteOrder: (orderId) => {
        const deletedAt = new Date().toISOString();
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, deletedAt } : o
          ),
        }));
        softDeleteOrderInSupabase(orderId, deletedAt).catch(console.error);
      },
      restoreOrder: (orderId) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, deletedAt: undefined } : o
          ),
        })),
      getDeletedOrders: (): Order[] => {
        const state = get();
        return state.orders.filter((o) => o.deletedAt).sort((a, b) =>
          new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime()
        );
      },
      permanentDeleteOrder: (orderId) => {
        set((state) => ({
          orders: state.orders.filter((o) => o.id !== orderId),
        }));
        hardDeleteOrderFromSupabase(orderId).catch(console.error);
      },
      deleteBatch: (batchId) =>
        set((state) => ({
          orders: state.orders.filter((o) => o.batchId !== batchId),
          batches: state.batches.filter((b) => b.id !== batchId),
        })),
      addUser: (user) => {
        set((state) => ({ users: [...state.users, user] }));
        syncUser(user).catch(console.error);
      },
      updateUser: (userId, updates) => {
        set((state) => {
          const updatedUsers = state.users.map((u) => u.id === userId ? { ...u, ...updates } : u);
          const updated = updatedUsers.find(u => u.id === userId);
          if (updated) syncUser(updated).catch(console.error);
          return { users: updatedUsers };
        });
      },
      deleteUser: (userId) => {
        set((state) => ({ users: state.users.filter((u) => u.id !== userId) }));
        deleteUserFromSupabase(userId).catch(console.error);
      },
      setCurrentUser: (userId) => set({ currentUserId: userId }),
      setEmailConfig: (config) =>
        set((state) => ({ emailConfig: { ...state.emailConfig, ...config } })),
      setAccessControl: (config) => set({ accessControl: config }),
      clearEodEvents: () => set({ eodEvents: [] }),
      addReturn: (ret) => {
        set((state) => ({
          returns: [...state.returns, ret],
          orders: state.orders.map((o) =>
            o.id === ret.orderId ? { ...o, status: 'returned', returnId: ret.id } : o
          ),
        }));
        syncReturn(ret).catch(console.error);
      },
      updateReturn: (returnId, updates) => {
        set((state) => {
          const updatedReturns = state.returns.map((r) => r.id === returnId ? { ...r, ...updates } : r);
          const updated = updatedReturns.find(r => r.id === returnId);
          if (updated) syncReturn(updated).catch(console.error);
          return { returns: updatedReturns };
        });
      },
      processReturn: (returnId, resolution, processedByUserId, processedByUserName) => {
        set((state) => {
          const newStatus: ReturnRecord['status'] =
            resolution === 'refund' ? 'refunded' : resolution === 'swap' ? 'swap' : 'replacement';
          const updatedReturns = state.returns.map((r) =>
            r.id === returnId ? { ...r, resolution, status: newStatus, processedByUserId, processedByUserName } : r
          );
          const updated = updatedReturns.find(r => r.id === returnId);
          if (updated) syncReturn(updated).catch(console.error);
          return { returns: updatedReturns };
        });
      },
      addReplacementItem: (returnId, item) => {
        set((state) => {
          const updatedReturns = state.returns.map((r) =>
            r.id === returnId ? { ...r, replacementItems: [...(r.replacementItems || []), item] } : r
          );
          const updated = updatedReturns.find(r => r.id === returnId);
          if (updated) syncReturn(updated).catch(console.error);
          return { returns: updatedReturns };
        });
      },
      addMissingItem: (record) => {
        set((state) => ({ missingItems: [...state.missingItems, record] }));
        syncMissingItem(record).catch(console.error);
      },
      updateMissingItem: (id, updates) =>
        set((state) => {
          const missingItems = state.missingItems.map((m) => m.id === id ? { ...m, ...updates } : m);
          const updated = missingItems.find((m) => m.id === id);
          if (updated) syncMissingItem(updated).catch(console.error);
          return { missingItems };
        }),
      createMissingItemOrder: (missingItemId) => {
        const state = get();
        const record = state.missingItems.find((m) => m.id === missingItemId);
        if (!record) throw new Error('Missing item record not found');
        if (record.dispatchOrderId) {
          const existing = state.orders.find((o) => o.id === record.dispatchOrderId);
          if (existing) return existing;
        }
        const originalOrder = state.orders.find((o) => o.id === record.orderId);
        if (!originalOrder) throw new Error('Original order not found');
        const now = new Date().toISOString();
        const newOrderId = generateUUID();
        const salesRecordNumber = `MISS-${originalOrder.salesRecordNumber}`;
        let batch = state.batches.find((b) => b.name === 'Missing Parts');
        if (!batch) {
          batch = { id: generateUUID(), name: 'Missing Parts', importedAt: now, orderCount: 1, source: 'manual' };
        } else {
          batch = { ...batch, orderCount: batch.orderCount + 1 };
        }
        const partsSummary = record.missingParts.map((p) => `${p.description} (x${p.quantity})`).join(', ');
        const newOrder: Order = {
          ...originalOrder,
          id: newOrderId,
          salesRecordNumber,
          orderNumber: `MISS-${originalOrder.orderNumber}`,
          status: 'pending',
          itemTitle: `MISSING PARTS: ${partsSummary}`,
          quantity: 1,
          soldFor: 0,
          postageAndPackaging: 0,
          totalPrice: 0,
          isReplacement: true,
          originalOrderId: originalOrder.id,
          importedAt: now,
          batchId: batch.id,
          saleDate: now,
          paidOnDate: now,
          postByDate: now,
          dispatchedOnDate: '',
          trackingNumber: '',
          deliveryService: '',
          comments: `Missing parts dispatch for order ${originalOrder.salesRecordNumber}`,
          notes: [
            {
              id: generateUUID(),
              text: `Missing parts: ${partsSummary}${record.notes ? ' — ' + record.notes : ''}`,
              authorId: 'system',
              authorName: 'System',
              createdAt: now,
            },
          ],
        };
        set((state) => ({
          orders: [...state.orders, newOrder],
          batches: state.batches.some((b) => b.id === batch!.id)
            ? state.batches.map((b) => (b.id === batch!.id ? batch! : b))
            : [...state.batches, batch!],
          missingItems: state.missingItems.map((m) =>
            m.id === missingItemId ? { ...m, dispatchOrderId: newOrderId, status: 'dispatched' } : m
          ),
        }));
        const dispatched = get().missingItems.find((m) => m.id === missingItemId);
        if (dispatched) syncMissingItem(dispatched).catch(console.error);
        syncBatch(batch, state.currentUserId || undefined).catch(console.error);
        syncOrder(newOrder).catch(console.error);
        return newOrder;
      },
      // ── Support Tickets ──
      addTicket: (ticket) => {
        set((state) => ({ tickets: [ticket, ...state.tickets] }));
        syncTicket(ticket).catch(console.error);
      },
      updateTicket: (id, updates, activity) => {
        set((state) => {
          const tickets = state.tickets.map((t) => {
            if (t.id !== id) return t;
            const now = new Date().toISOString();
            const merged: TicketRecord = {
              ...t,
              ...updates,
              updatedAt: now,
              activity: activity ? [...(t.activity ?? []), { id: generateUUID(), ...activity, at: now }] : (t.activity ?? []),
            };
            // Stamp resolved time when moving into a terminal state
            if (updates.status && (updates.status === 'resolved' || updates.status === 'closed') && !t.resolvedAt) {
              merged.resolvedAt = now;
            }
            syncTicket(merged).catch(console.error);
            return merged;
          });
          return { tickets };
        });
      },
      editTicketActivity: (ticketId, activityId, text) => {
        set((state) => {
          const tickets = state.tickets.map((t) => {
            if (t.id !== ticketId) return t;
            const now = new Date().toISOString();
            const merged: TicketRecord = {
              ...t,
              updatedAt: now,
              activity: (t.activity ?? []).map((a) =>
                a.id === activityId && a.type === 'note' ? { ...a, text, editedAt: now } : a
              ),
            };
            syncTicket(merged).catch(console.error);
            return merged;
          });
          return { tickets };
        });
      },
      deleteTicketActivity: (ticketId, activityId) => {
        set((state) => {
          const tickets = state.tickets.map((t) => {
            if (t.id !== ticketId) return t;
            const merged: TicketRecord = {
              ...t,
              updatedAt: new Date().toISOString(),
              activity: (t.activity ?? []).filter((a) => !(a.id === activityId && a.type === 'note')),
            };
            syncTicket(merged).catch(console.error);
            return merged;
          });
          return { tickets };
        });
      },
      deleteTicket: (id) => {
        set((state) => ({ tickets: state.tickets.filter((t) => t.id !== id) }));
        deleteTicketFromSupabase(id).catch(console.error);
      },
      // ── Inventory ──
      upsertInventoryPart: (part) => {
        set((state) => {
          const exists = state.inventoryParts.some((p) => p.id === part.id);
          return {
            inventoryParts: exists
              ? state.inventoryParts.map((p) => (p.id === part.id ? part : p))
              : [part, ...state.inventoryParts],
          };
        });
        syncInventoryPart(part).catch(console.error);
      },
      saveGoodsReceipt: (receipt) => {
        set((state) => {
          const exists = state.goodsReceipts.some((r) => r.id === receipt.id);
          return {
            goodsReceipts: exists
              ? state.goodsReceipts.map((r) => (r.id === receipt.id ? receipt : r))
              : [receipt, ...state.goodsReceipts],
          };
        });
        syncGoodsReceipt(receipt).catch(console.error);
      },
      deleteGoodsReceipt: (id) => {
        set((state) => ({ goodsReceipts: state.goodsReceipts.filter((r) => r.id !== id) }));
      },
      updateStockUnit: (id, updates) => {
        set((state) => {
          const stockUnits = state.stockUnits.map((u) =>
            u.id === id ? { ...u, ...updates, updatedAt: new Date().toISOString() } : u
          );
          const updated = stockUnits.find((u) => u.id === id);
          if (updated) syncStockUnit(updated).catch(console.error);
          return { stockUnits };
        });
      },
      postGoodsReceipt: (receiptId) => {
        const state = get();
        const receipt = state.goodsReceipts.find((r) => r.id === receiptId);
        if (!receipt || receipt.status === 'posted') return;
        const now = new Date().toISOString();
        const user = state.users.find((u) => u.id === state.currentUserId);

        const parts = [...state.inventoryParts];
        const newUnits: StockUnit[] = [];
        const levels = [...state.stockLevels];
        const touchedParts: InventoryPart[] = [];
        const touchedLevels: StockLevel[] = [];

        const findOrCreatePart = (line: GoodsReceipt['lines'][number]): InventoryPart => {
          // Scanned lines carry the exact part id — receive straight into it.
          if (line.partId) {
            const existing = parts.find((p) => p.id === line.partId);
            if (existing) return existing;
          }
          // Catalog-linked lines collapse onto one part per catalog product.
          if (line.catalogProductId) {
            const byCatalog = parts.find((p) => p.catalogProductId === line.catalogProductId);
            if (byCatalog) return byCatalog;
          }
          const sku = buildSku(line.category, line.attributes);
          let part = parts.find((p) => p.sku === sku && p.category === line.category);
          if (!part) {
            const cat = INVENTORY_CATEGORY_MAP[line.category];
            part = {
              id: generateUUID(), sku, category: line.category,
              tracking: line.tracking,
              name: line.catalogName ?? `${cat?.label ?? line.category}${sku.replace(line.category.toUpperCase(), '').replace(/-/g, ' ')}`.trim(),
              attributes: line.attributes, createdAt: now, updatedAt: now,
              catalogProductId: line.catalogProductId,
              imageUrl: line.catalogImageUrl,
            };
            parts.push(part);
            touchedParts.push(part);
          }
          return part;
        };

        for (const line of receipt.lines) {
          if (!line.quantity || line.quantity < 1) continue;
          const part = findOrCreatePart(line);

          if (line.tracking === 'serialized') {
            for (let i = 0; i < line.quantity; i++) {
              newUnits.push({
                id: generateUUID(), partId: part.id, grade: line.grade, status: 'in_stock',
                location: line.location, attributes: line.attributes, goodsReceiptId: receipt.id,
                unitCost: line.unitCost, receivedAt: receipt.receivedAt, createdAt: now, updatedAt: now,
              });
            }
          } else {
            let level = levels.find((l) => l.partId === part.id && (l.grade ?? '') === (line.grade ?? '') && (l.location ?? '') === (line.location ?? ''));
            if (!level) {
              level = { id: generateUUID(), partId: part.id, grade: line.grade, location: line.location, quantity: 0, updatedAt: now };
              levels.push(level);
            }
            level.quantity += line.quantity;
            level.updatedAt = now;
            if (!touchedLevels.includes(level)) touchedLevels.push(level);
          }
        }

        const postedReceipt: GoodsReceipt = {
          ...receipt, status: 'posted', postedAt: now,
          receivedById: receipt.receivedById ?? user?.id,
          receivedByName: receipt.receivedByName ?? user?.name,
          updatedAt: now,
        };

        set({
          inventoryParts: parts,
          stockUnits: [...newUnits, ...state.stockUnits],
          stockLevels: levels,
          goodsReceipts: state.goodsReceipts.map((r) => (r.id === receiptId ? postedReceipt : r)),
        });

        // Persist everything that changed
        touchedParts.forEach((p) => syncInventoryPart(p).catch(console.error));
        newUnits.forEach((u) => syncStockUnit(u).catch(console.error));
        touchedLevels.forEach((l) => syncStockLevel(l).catch(console.error));
        syncGoodsReceipt(postedReceipt).catch(console.error);
      },
      // ── Builds (assembly) ──
      saveBuild: (build) => {
        const state = get();
        const existing = state.builds.find((b) => b.id === build.id);
        // Serialized units referenced by the build go on hold (in_build) while reserved.
        const newUnitIds = build.status === 'reserved'
          ? build.lines.map((l) => l.stockUnitId).filter(Boolean) as string[]
          : [];
        const prevUnitIds = existing?.lines.map((l) => l.stockUnitId).filter(Boolean) as string[] | undefined;
        const releaseIds = (prevUnitIds ?? []).filter((id) => !newUnitIds.includes(id));

        set((s) => {
          const builds = existing
            ? s.builds.map((b) => (b.id === build.id ? build : b))
            : [build, ...s.builds];
          const stockUnits = s.stockUnits.map((u) => {
            if (newUnitIds.includes(u.id) && u.status === 'in_stock') return { ...u, status: 'in_build' as const, updatedAt: new Date().toISOString() };
            if (releaseIds.includes(u.id) && u.status === 'in_build') return { ...u, status: 'in_stock' as const, updatedAt: new Date().toISOString() };
            return u;
          });
          return { builds, stockUnits };
        });

        syncBuild(build).catch(console.error);
        get().stockUnits.filter((u) => newUnitIds.includes(u.id) || releaseIds.includes(u.id))
          .forEach((u) => syncStockUnit(u).catch(console.error));
      },
      // ── Component swaps (assembly) ──
      // Adjust a bulk part's on-hand quantity by `delta`, creating the part +
      // stock level if needed. Returns the touched part/level so callers persist.
      recordBuildSwap: (orderId, swap) => {
        const state = get();
        const now = new Date().toISOString();
        const user = state.users.find((u) => u.id === state.currentUserId);

        const parts = [...state.inventoryParts];
        const levels = [...state.stockLevels];
        const touchedParts: InventoryPart[] = [];
        const touchedLevels: StockLevel[] = [];

        const adjust = (category: string, attributes: Record<string, string | number>, delta: number) => {
          if (!delta) return;
          const sku = buildSku(category, attributes);
          let part = parts.find((p) => p.sku === sku && p.category === category);
          if (!part) {
            const cat = INVENTORY_CATEGORY_MAP[category];
            part = {
              id: generateUUID(), sku, category, tracking: 'bulk',
              name: `${cat?.label ?? category} ${sku.replace(`${category.toUpperCase()}-`, '').replace(/-/g, ' ')}`.trim(),
              attributes, createdAt: now, updatedAt: now,
            };
            parts.push(part);
            touchedParts.push(part);
          }
          // Harvested/consumed stock is tracked at the default (no grade/location) level.
          let level = levels.find((l) => l.partId === part!.id && !l.grade && !l.location);
          if (!level) {
            level = { id: generateUUID(), partId: part.id, quantity: 0, updatedAt: now };
            levels.push(level);
          }
          level.quantity += delta;   // negative allowed (consumed beyond on-hand)
          level.updatedAt = now;
          if (!touchedLevels.includes(level)) touchedLevels.push(level);
        };

        // Removed parts go back to stock (+); the installed replacement is consumed (−).
        adjust(swap.category, swap.outAttributes, swap.outQty);
        adjust(swap.category, swap.inAttributes, -swap.inQty);

        const fullSwap: BuildSwap = { ...swap, at: swap.at || now, byId: swap.byId ?? user?.id, byName: swap.byName ?? user?.name };

        set((s) => {
          const existing = s.builds.find((b) => b.orderId === orderId && b.status !== 'cancelled');
          const build: Build = existing
            ? { ...existing, swaps: [...(existing.swaps ?? []), fullSwap], updatedAt: now }
            : { id: generateUUID(), orderId, status: 'reserved', lines: [], swaps: [fullSwap], createdById: user?.id, createdByName: user?.name, reservedAt: now, createdAt: now, updatedAt: now };
          const builds = existing ? s.builds.map((b) => (b.id === build.id ? build : b)) : [build, ...s.builds];
          syncBuild(build).catch(console.error);
          return { builds, inventoryParts: parts, stockLevels: levels };
        });

        touchedParts.forEach((p) => syncInventoryPart(p).catch(console.error));
        touchedLevels.forEach((l) => syncStockLevel(l).catch(console.error));
      },
      removeBuildSwap: (orderId, swapId) => {
        const state = get();
        const build = state.builds.find((b) => b.orderId === orderId && b.status !== 'cancelled');
        const swap = build?.swaps?.find((sw) => sw.id === swapId);
        if (!build || !swap) return;
        const now = new Date().toISOString();
        const parts = [...state.inventoryParts];
        const levels = [...state.stockLevels];
        const touchedLevels: StockLevel[] = [];

        const adjust = (attributes: Record<string, string | number>, delta: number) => {
          if (!delta) return;
          const sku = buildSku(swap.category, attributes);
          const part = parts.find((p) => p.sku === sku && p.category === swap.category);
          if (!part) return;
          const level = levels.find((l) => l.partId === part.id && !l.grade && !l.location);
          if (!level) return;
          level.quantity += delta;
          level.updatedAt = now;
          if (!touchedLevels.includes(level)) touchedLevels.push(level);
        };
        // Reverse the original adjustment: pull the returned parts back out, restore the consumed one.
        adjust(swap.outAttributes, -swap.outQty);
        adjust(swap.inAttributes, swap.inQty);

        const updated: Build = { ...build, swaps: (build.swaps ?? []).filter((sw) => sw.id !== swapId), updatedAt: now };
        set((s) => ({ builds: s.builds.map((b) => (b.id === build.id ? updated : b)), stockLevels: levels }));
        syncBuild(updated).catch(console.error);
        touchedLevels.forEach((l) => syncStockLevel(l).catch(console.error));
      },
      cancelBuild: (buildId) => {
        const state = get();
        const build = state.builds.find((b) => b.id === buildId);
        if (!build || build.status === 'consumed') return;
        const unitIds = build.lines.map((l) => l.stockUnitId).filter(Boolean) as string[];
        const now = new Date().toISOString();
        const cancelled: Build = { ...build, status: 'cancelled', updatedAt: now };
        set((s) => ({
          builds: s.builds.map((b) => (b.id === buildId ? cancelled : b)),
          stockUnits: s.stockUnits.map((u) => (unitIds.includes(u.id) && u.status === 'in_build') ? { ...u, status: 'in_stock' as const, updatedAt: now } : u),
        }));
        syncBuild(cancelled).catch(console.error);
        get().stockUnits.filter((u) => unitIds.includes(u.id)).forEach((u) => syncStockUnit(u).catch(console.error));
      },
      consumeBuild: (buildId) => {
        const state = get();
        const build = state.builds.find((b) => b.id === buildId);
        if (!build || build.status === 'consumed') return;
        const now = new Date().toISOString();

        const levels = [...state.stockLevels];
        const touchedLevels: StockLevel[] = [];
        const consumedUnitIds: string[] = [];

        for (const line of build.lines) {
          const part = state.inventoryParts.find((p) => p.id === line.partId);
          if (line.stockUnitId) {
            consumedUnitIds.push(line.stockUnitId);
          } else if (part?.tracking !== 'serialized') {
            // Deduct bulk quantity — negative is allowed (warehouse is never blocked).
            let level = levels.find((l) => l.partId === line.partId);
            if (!level) {
              level = { id: generateUUID(), partId: line.partId, quantity: 0, updatedAt: now };
              levels.push(level);
            }
            level.quantity -= (line.quantity || 1);
            level.updatedAt = now;
            if (!touchedLevels.includes(level)) touchedLevels.push(level);
          }
        }

        const consumed: Build = { ...build, status: 'consumed', consumedAt: now, updatedAt: now };
        set((s) => ({
          builds: s.builds.map((b) => (b.id === buildId ? consumed : b)),
          stockLevels: levels,
          stockUnits: s.stockUnits.map((u) => consumedUnitIds.includes(u.id) ? { ...u, status: 'sold' as const, updatedAt: now } : u),
        }));

        syncBuild(consumed).catch(console.error);
        touchedLevels.forEach((l) => syncStockLevel(l).catch(console.error));
        get().stockUnits.filter((u) => consumedUnitIds.includes(u.id)).forEach((u) => syncStockUnit(u).catch(console.error));
      },
      pickOrderComponents: (orderId, specs) => {
        const state = get();
        // Idempotent: if this order already has a consumed pick, just (re)mark it
        // picked — never deduct the same order's components twice.
        if (state.builds.some((b) => b.orderId === orderId && b.status === 'consumed')) {
          get().setOrderPicked(orderId, true);
          return;
        }
        const now = new Date().toISOString();
        const user = state.users.find((u) => u.id === state.currentUserId);

        // Resolve each tapped component to an inventory part by SKU (find-or-create),
        // so picking deducts and a later Goods Inward of the same spec balances it.
        const parts = [...state.inventoryParts];
        const newParts: InventoryPart[] = [];
        const lines: BuildLine[] = [];
        for (const spec of specs) {
          if (!spec.quantity || spec.quantity < 1) continue;
          const sku = buildSku(spec.category, spec.attributes);
          let part = parts.find((p) => p.sku === sku && p.category === spec.category);
          if (!part) {
            part = {
              id: generateUUID(), sku, name: spec.label, category: spec.category,
              tracking: 'bulk', attributes: spec.attributes, createdAt: now, updatedAt: now,
            };
            parts.push(part);
            newParts.push(part);
          }
          lines.push({ partId: part.id, category: spec.category, description: spec.label, quantity: spec.quantity });
        }

        if (lines.length === 0) { get().setOrderPicked(orderId, true); return; }

        const build: Build = {
          id: generateUUID(), orderId, status: 'reserved', lines,
          createdById: user?.id, createdByName: user?.name,
          reservedAt: now, createdAt: now, updatedAt: now,
        };
        set((s) => ({
          inventoryParts: [...s.inventoryParts, ...newParts],
          // Drop any prior non-consumed build for this order, keep the new one.
          builds: [...s.builds.filter((b) => b.orderId !== orderId || b.status === 'consumed'), build],
        }));
        get().setOrderPicked(orderId, true);
        // Persist the new parts BEFORE deducting: consumeBuild syncs stock_levels,
        // whose FK references inventory_parts, so the parts must exist in Supabase
        // first or the level insert is rejected (local negative stock is unaffected).
        Promise.all(newParts.map((p) => syncInventoryPart(p)))
          .catch((e) => console.error('[pick] part sync failed', e))
          .finally(() => get().consumeBuild(build.id));   // deduct now — negative allowed
      },
      createReplacementOrder: (returnId, overrides) => {
        const state = get();
        const ret = state.returns.find((r) => r.id === returnId);
        if (!ret) throw new Error('Return not found');
        if (ret.replacementOrderId) {
          const existing = state.orders.find((o) => o.id === ret.replacementOrderId);
          if (existing) return existing;
        }

        const originalOrder = state.orders.find((o) => o.id === ret.orderId);
        if (!originalOrder) throw new Error('Original order not found');

        const replacementItem = ret.replacementItems?.[0];
        const now = new Date().toISOString();
        const newOrderId = generateUUID();
        const isSwap = ret.resolution === 'swap';
        const prefix = isSwap ? 'SWAP' : 'REPL';
        const salesRecordNumber = `${prefix}-${originalOrder.salesRecordNumber}`;

        let batch = state.batches.find((b) => b.name === 'Replacements');
        if (!batch) {
          batch = { id: generateUUID(), name: 'Replacements', importedAt: now, orderCount: 1, source: 'manual' };
        } else {
          batch = { ...batch, orderCount: batch.orderCount + 1 };
        }

        const newOrder: Order = {
          ...originalOrder,
          id: newOrderId,
          salesRecordNumber,
          orderNumber: `${prefix}-${originalOrder.orderNumber}`,
          status: 'pending',
          itemTitle: replacementItem?.itemTitle ?? originalOrder.itemTitle,
          quantity: replacementItem?.quantity ?? originalOrder.quantity,
          soldFor: 0,
          postageAndPackaging: 0,
          totalPrice: 0,
          isReplacement: true,
          originalOrderId: originalOrder.id,
          returnId: ret.id,
          importedAt: now,
          batchId: batch.id,
          saleDate: now,
          paidOnDate: now,
          postByDate: now,
          dispatchedOnDate: '',
          trackingNumber: '',
          deliveryService: '',
          comments: isSwap
            ? `Swap for return ${ret.id} — sent before faulty item received back`
            : `Replacement for return ${ret.id}`,
          notes: [
            {
              id: generateUUID(),
              text: isSwap
                ? 'Swap order created — replacement dispatched ahead of the faulty item coming back'
                : 'Replacement order created from return',
              authorId: 'system',
              authorName: 'System',
              createdAt: now,
            },
          ],
          ...overrides,
        };

        set((state) => ({
          orders: [...state.orders, newOrder],
          batches: state.batches.some((b) => b.id === batch.id)
            ? state.batches.map((b) => (b.id === batch.id ? batch : b))
            : [...state.batches, batch],
          returns: state.returns.map((r) =>
            r.id === returnId ? { ...r, replacementOrderId: newOrderId } : r
          ),
        }));

        syncBatch(batch, state.currentUserId || undefined).catch(console.error);
        syncOrder(newOrder).catch(console.error);
        const updatedReturn = get().returns.find((r) => r.id === returnId);
        if (updatedReturn) syncReturn(updatedReturn).catch(console.error);

        return newOrder;
      },
      // HR Actions
      clockIn: (userId, notes) =>
        set((state) => {
          const today = new Date().toISOString().slice(0, 10);
          const existing = state.attendanceRecords.find(
            (r) => r.userId === userId && r.date === today
          );
          if (existing) return {}; // Already clocked in
          const record: AttendanceRecord = {
            id: generateUUID(),
            userId,
            date: today,
            clockIn: new Date().toISOString(),
            status: 'present',
            notes,
          };
          // Sync to Supabase in background
          syncAttendance(record).catch(console.error);
          return { attendanceRecords: [...state.attendanceRecords, record] };
        }),
      clockOut: (userId) =>
        set((state) => {
          const today = new Date().toISOString().slice(0, 10);
          const updatedRecords = state.attendanceRecords.map((r) =>
            r.userId === userId && r.date === today && !r.clockOut
              ? { ...r, clockOut: new Date().toISOString() }
              : r
          );
          // Sync to Supabase
          const updated = updatedRecords.find(r => r.userId === userId && r.date === today);
          if (updated) syncAttendance(updated).catch(console.error);
          return { attendanceRecords: updatedRecords };
        }),
      updateAttendance: (recordId, updates) =>
        set((state) => {
          const updatedRecords = state.attendanceRecords.map((r) =>
            r.id === recordId ? { ...r, ...updates } : r
          );
          const updated = updatedRecords.find(r => r.id === recordId);
          if (updated) syncAttendance(updated).catch(console.error);
          return { attendanceRecords: updatedRecords };
        }),
      addLeaveRequest: (request) =>
        set((state) => {
          const newRequest: LeaveRequest = {
            ...request,
            id: generateUUID(),
            requestedAt: new Date().toISOString(),
            status: 'pending',
          };
          syncLeaveRequest(newRequest).catch(console.error);
          return { leaveRequests: [...state.leaveRequests, newRequest] };
        }),
      approveLeave: (requestId, approverId) =>
        set((state) => {
          const updatedRequests = state.leaveRequests.map((r) =>
            r.id === requestId
              ? { ...r, status: 'approved' as const, approvedBy: approverId, approvedAt: new Date().toISOString() }
              : r
          );
          const updated = updatedRequests.find(r => r.id === requestId);
          if (updated) syncLeaveRequest(updated).catch(console.error);
          return { leaveRequests: updatedRequests };
        }),
      rejectLeave: (requestId, reason) =>
        set((state) => {
          const updatedRequests = state.leaveRequests.map((r) =>
            r.id === requestId
              ? { ...r, status: 'rejected' as const, rejectionReason: reason }
              : r
          );
          const updated = updatedRequests.find(r => r.id === requestId);
          if (updated) syncLeaveRequest(updated).catch(console.error);
          return { leaveRequests: updatedRequests };
        }),
      cancelLeave: (requestId) =>
        set((state) => {
          const updatedRequests = state.leaveRequests.map((r) =>
            r.id === requestId ? { ...r, status: 'cancelled' as const } : r
          );
          const updated = updatedRequests.find(r => r.id === requestId);
          if (updated) syncLeaveRequest(updated).catch(console.error);
          return { leaveRequests: updatedRequests };
        }),
      updateLeaveBalance: (userId, year, updates) => {
        set((state) => {
          const existing = state.leaveBalances.find(
            (b) => b.userId === userId && b.year === year
          );
          let updatedBalances;
          let balanceToSync: LeaveBalance;
          
          if (existing) {
            updatedBalances = state.leaveBalances.map((b) =>
              b.userId === userId && b.year === year ? { ...b, ...updates } : b
            );
            balanceToSync = updatedBalances.find(b => b.userId === userId && b.year === year)!;
          } else {
            // Create default balance if not exists
            balanceToSync = {
              userId,
              year,
              annual: 25,
              sick: 10,
              unpaid: 999,
              used: { annual: 0, sick: 0, unpaid: 0, other: 0 },
              ...updates,
            };
            updatedBalances = [...state.leaveBalances, balanceToSync];
          }
          
          syncLeaveBalance(balanceToSync).catch(console.error);
          return { leaveBalances: updatedBalances };
        });
      },
    }),
    {
      name: 'ebay-orders-idb-v6',
      storage: idbStorage(),
      version: 6,
      migrate: async (persistedState: unknown, _fromVersion: number) => {
        // Always carry forward everything and patch any missing fields
        const s = (persistedState ?? {}) as Partial<OrderStore>;
        return {
          orders:      s.orders      ?? [],
          batches:     s.batches     ?? [],
          eodEvents:   s.eodEvents   ?? [],
          returns:     s.returns     ?? [],
          missingItems: (s as OrderStore).missingItems ?? [],
          tickets: (s as OrderStore).tickets ?? [],
          inventoryParts: (s as OrderStore).inventoryParts ?? [],
          stockUnits: (s as OrderStore).stockUnits ?? [],
          stockLevels: (s as OrderStore).stockLevels ?? [],
          goodsReceipts: (s as OrderStore).goodsReceipts ?? [],
          builds: (s as OrderStore).builds ?? [],
          attendanceRecords: (s as OrderStore).attendanceRecords ?? [],
          leaveRequests: (s as OrderStore).leaveRequests ?? [],
          leaveBalances: (s as OrderStore).leaveBalances ?? [],
          users:       s.users       ?? [
            { id: 'admin-1', name: 'Admin', role: 'admin', roles: ['admin'], department: 'management', departments: ['management'] as Department[], pin: '1234' },
          ],
          currentUserId: s.currentUserId ?? null,
          emailConfig: (s as OrderStore).emailConfig ?? {
            enabled: false,
            recipientEmail: '',
            smtpHost: '',
            smtpPort: 587,
            smtpUser: '',
            smtpPass: '',
            fromAddress: '',
            autoSendAt8pm: true,
          },
        } as OrderStore;
      },
    }
  )
);
