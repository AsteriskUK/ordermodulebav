import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { get, set as idbSet, del } from 'idb-keyval';
import { Order, OrderStatus, Batch, DeliveryCarrier, DeliveryType, AppUser, EodEvent, ReturnRecord } from './types';

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
  addOrders: (orders: Order[], batch: Batch) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  updateOrderComment: (orderId: string, comment: string) => void;
  updateOrderTracking: (orderId: string, trackingNumber: string) => void;
  updateOrderCarrier: (orderId: string, carrier: DeliveryCarrier, deliveryType: DeliveryType) => void;
  updateOrderLabelQty: (orderId: string, qty: number) => void;
  bulkUpdateStatus: (orderIds: string[], status: OrderStatus) => void;
  deleteOrder: (orderId: string) => void;
  deleteBatch: (batchId: string) => void;
  addUser: (user: AppUser) => void;
  updateUser: (userId: string, updates: Partial<AppUser>) => void;
  deleteUser: (userId: string) => void;
  setCurrentUser: (userId: string | null) => void;
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
        { id: 'admin-1', name: 'Admin', role: 'admin', roles: ['admin'], department: 'management', pin: '1234' },
      ],
      currentUserId: null,
      addOrders: (newOrders, batch) =>
        set((state) => ({
          orders: [...state.orders, ...newOrders],
          batches: [...state.batches, batch],
        })),
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
      name: 'ebay-orders-idb-v3',
      storage: idbStorage(),
    }
  )
);
