export type OrderStatus = 'pending' | 'assembling' | 'checking' | 'packing' | 'packed' | 'shipped' | 'delivered' | 'held' | 'cancelled' | 'refunded' | 'returned';

export type DeliveryCarrier = 'DPD' | 'FedEx' | 'Parcelforce' | 'Royal Mail' | 'Other';
export type DeliveryType = 'standard' | 'next_day';

export type UserRole = 'admin' | 'manager' | 'staff' | 'comms';
export type Department = 'warehouse' | 'comms' | 'management' | 'all';

export interface UserTarget {
  action: OrderStatus;
  dailyTarget: number;
}

export interface AppUser {
  id: string;
  name: string;
  role: UserRole;
  roles: UserRole[];
  department: Department;
  pin?: string;
  targets?: UserTarget[];
}

export interface EodEvent {
  orderId: string;
  salesRecordNumber: string;
  itemTitle: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  changedAt: string;
  userId?: string;
  userName?: string;
  department?: Department;
}

export interface ReturnRecord {
  id: string;
  orderId: string;
  salesRecordNumber: string;
  itemTitle: string;
  reason: string;
  notes: string;
  returnedAt: string;
  processedByUserId?: string;
  processedByUserName?: string;
  refundAmount?: number;
  status: 'pending' | 'received' | 'refunded' | 'rejected';
}

export interface EodReport {
  date: string;
  events: EodEvent[];
  totalShipped: number;
  totalPacked: number;
  totalRevenue: number;
}

export type PackagingStage = 'assembling' | 'checking' | 'packing';

export interface Order {
  id: string;
  salesRecordNumber: string;
  orderNumber: string;
  buyerUsername: string;
  buyerName: string;
  buyerEmail: string;
  buyerNote: string;
  // Shipping address
  postToName: string;
  postToPhone: string;
  postToAddress1: string;
  postToAddress2: string;
  postToCity: string;
  postToCounty: string;
  postToPostcode: string;
  postToCountry: string;
  // Item details
  itemNumber: string;
  itemTitle: string;
  customLabel: string;
  variation: string;
  quantity: number;
  soldFor: number;
  postageAndPackaging: number;
  totalPrice: number;
  // Dates
  saleDate: string;
  paidOnDate: string;
  postByDate: string;
  dispatchedOnDate: string;
  // Shipping
  deliveryService: string;
  trackingNumber: string;
  deliveryCarrier: DeliveryCarrier;
  deliveryType: DeliveryType;
  // Status
  status: OrderStatus;
  category: string;
  comments: string;
  // Shipping label
  labelQty: number;
  // GSP / international
  isGSP: boolean;
  // Return tracking
  returnId?: string;
  // Metadata
  importedAt: string;
  batchId: string;
}

export interface Batch {
  id: string;
  name: string;
  importedAt: string;
  orderCount: number;
  source: 'ebay' | 'backmarket';
}

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  assembling: { label: 'Assembling', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  checking: { label: 'Checking', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  packing: { label: 'Packing', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  packed: { label: 'Packed', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  shipped: { label: 'Shipped', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800 border-green-300' },
  held: { label: 'On Hold', color: 'bg-red-100 text-red-800 border-red-300' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 border-gray-300' },
  refunded: { label: 'Refunded', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  returned: { label: 'Returned', color: 'bg-rose-100 text-rose-800 border-rose-300' },
};

export const PACKAGING_STAGES: { stage: PackagingStage; next: OrderStatus; label: string; description: string }[] = [
  { stage: 'assembling', next: 'checking', label: 'Assembling', description: 'Gather items, accessories, and prepare the order' },
  { stage: 'checking', next: 'packing', label: 'Checking', description: 'Quality check, verify item matches order, test functionality' },
  { stage: 'packing', next: 'packed', label: 'Packing', description: 'Box, wrap, seal, and label the package' },
];
