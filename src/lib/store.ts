import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { Order, OrderStatus, Batch, DeliveryCarrier, DeliveryType, AppUser, EodEvent, ReturnRecord, Department } from './types';

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
  updateOrderTracking: (orderId: string, trackingNumber: string) => void;
  updateOrderCarrier: (orderId: string, carrier: DeliveryCarrier, deliveryType: DeliveryType) => void;
  updateOrderLabelQty: (orderId: string, qty: number) => void;
  updateOrderCategory: (orderId: string, category: string) => void;
  updateOrderPriority: (orderId: string, priority: number) => void;
  updateOrderNumberOfBoxes: (orderId: string, numberOfBoxes: number) => void;
  bulkUpdateStatus: (orderIds: string[], status: OrderStatus) => void;
  deleteOrder: (orderId: string) => void;
  deleteBatch: (batchId: string) => void;
  addUser: (user: AppUser) => void;
  updateUser: (userId: string, updates: Partial<AppUser>) => void;
  deleteUser: (userId: string) => void;
  setCurrentUser: (userId: string | null) => void;
  setEmailConfig: (config: Partial<EmailConfig>) => void;
  clearEodEvents: () => void;
  addReturn: (ret: ReturnRecord) => void;
  updateReturn: (returnId: string, updates: Partial<ReturnRecord>) => void;
}

export const useOrderStore = create<OrderStore>()(
  persist(
    (set) => ({
      orders: [],
      batches: [],
      eodEvents: [],
      returns: [],
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
          // Set default priority and numberOfBoxes for new orders
          const ordersWithDefaults = newOrders.map(order => ({
            ...order,
            priority: order.priority ?? 5, // Default to lowest priority
            numberOfBoxes: order.numberOfBoxes ?? 1, // Default to 1 box
          }));
          return {
            orders: [...state.orders, ...ordersWithDefaults],
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
          return {
            orders: state.orders.map((o) =>
              o.id === orderId ? { ...o, status } : o
            ),
            eodEvents: [...state.eodEvents, event],
          };
        }),
      updateOrderComment: (orderId, comment) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, comments: comment } : o
          ),
        })),
      updateOrderTracking: (orderId, trackingNumber) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, trackingNumber } : o
          ),
        })),
      updateOrderCarrier: (orderId, carrier, deliveryType) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, deliveryCarrier: carrier, deliveryType } : o
          ),
        })),
      updateOrderLabelQty: (orderId, qty) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, labelQty: qty } : o
          ),
        })),
      updateOrderCategory: (orderId, category) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, category } : o
          ),
        })),
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
              return { orders: [targetOrder, ...otherOrders] };
            }
          }
          
          return { orders: updatedOrders };
        }),
      updateOrderNumberOfBoxes: (orderId, numberOfBoxes) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === orderId ? { ...o, numberOfBoxes } : o
          ),
        })),
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
          return {
            orders: state.orders.map((o) =>
              orderIds.includes(o.id) ? { ...o, status } : o
            ),
            eodEvents: [...state.eodEvents, ...newEvents],
          };
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
      addUser: (user) =>
        set((state) => ({ users: [...state.users, user] })),
      updateUser: (userId, updates) =>
        set((state) => ({
          users: state.users.map((u) => u.id === userId ? { ...u, ...updates } : u),
        })),
      deleteUser: (userId) =>
        set((state) => ({ users: state.users.filter((u) => u.id !== userId) })),
      setCurrentUser: (userId) => set({ currentUserId: userId }),
      setEmailConfig: (config) =>
        set((state) => ({ emailConfig: { ...state.emailConfig, ...config } })),
      clearEodEvents: () => set({ eodEvents: [] }),
      addReturn: (ret) =>
        set((state) => ({
          returns: [...state.returns, ret],
          orders: state.orders.map((o) =>
            o.id === ret.orderId ? { ...o, status: 'returned', returnId: ret.id } : o
          ),
        })),
      updateReturn: (returnId, updates) =>
        set((state) => ({
          returns: state.returns.map((r) => r.id === returnId ? { ...r, ...updates } : r),
        })),
    }),
    {
      name: 'ebay-orders-idb-v5',
      storage: idbStorage(),
      version: 5,
      migrate: async (persistedState: unknown, _fromVersion: number) => {
        // Always carry forward everything and patch any missing fields
        const s = (persistedState ?? {}) as Partial<OrderStore>;
        return {
          orders:      s.orders      ?? [],
          batches:     s.batches     ?? [],
          eodEvents:   s.eodEvents   ?? [],
          returns:     s.returns     ?? [],
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
