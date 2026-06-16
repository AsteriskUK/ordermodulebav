import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { Order, OrderNote, OrderStatus, Batch, DeliveryCarrier, DeliveryType, AppUser, EodEvent, ReturnRecord, ReplacementItem, Department, AttendanceRecord, LeaveRequest, LeaveBalance } from './types';
import { syncAttendance, syncLeaveRequest, syncLeaveBalance, syncOrder, syncBatch, syncUser, deleteUserFromSupabase, syncReturn } from './supabase-store';

// Generate proper UUID v4 for PostgreSQL compatibility
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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
  addOrders: (orders: Order[], batch: Batch) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrderComment: (orderId: string, comment: string) => void;
  addOrderNote: (orderId: string, note: Omit<OrderNote, 'id' | 'createdAt'>) => void;
  deleteOrderNote: (orderId: string, noteId: string) => void;
  updateOrderTracking: (orderId: string, trackingNumber: string) => void;
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
  purgeOrphanOrders: () => void;
  deleteBatch: (batchId: string) => void;
  addUser: (user: AppUser) => void;
  updateUser: (userId: string, updates: Partial<AppUser>) => void;
  deleteUser: (userId: string) => void;
  setCurrentUser: (userId: string | null) => void;
  setEmailConfig: (config: Partial<EmailConfig>) => void;
  clearEodEvents: () => void;
  addReturn: (ret: ReturnRecord) => void;
  updateReturn: (returnId: string, updates: Partial<ReturnRecord>) => void;
  processReturn: (returnId: string, resolution: 'refund' | 'replacement', processedByUserId: string, processedByUserName: string) => void;
  addReplacementItem: (returnId: string, item: ReplacementItem) => void;
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
    (set) => ({
      orders: [],
      batches: [],
      eodEvents: [],
      returns: [],
      attendanceRecords: [],
      leaveRequests: [],
      leaveBalances: [],
      users: [
        { id: 'admin-1', name: 'Admin', role: 'admin', roles: ['admin'], department: 'management', departments: ['management'] as Department[], pin: '1234' },
      ],
      currentUserId: null,
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
          const ordersWithDefaults = newOrders.map(order => ({
            ...order,
            priority: order.priority ?? 5,
            numberOfBoxes: order.numberOfBoxes ?? 1,
          }));
          // Replace any existing order that shares a salesRecordNumber with an incoming order
          const incomingNums = new Set(ordersWithDefaults.map((o) => o.salesRecordNumber).filter(Boolean));
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
      updateOrderStatus: (orderId, status) =>
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
        }),
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
      deleteOrder: (orderId) =>
        set((state) => ({
          orders: state.orders.filter((o) => o.id !== orderId),
        })),
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
          const newStatus = resolution === 'refund' ? 'refunded' : 'replacement';
          const updatedReturns = state.returns.map((r) =>
            r.id === returnId ? { ...r, resolution, status: newStatus as any, processedByUserId, processedByUserName } : r
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
