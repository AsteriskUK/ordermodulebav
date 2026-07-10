import type { StockTracking, StockUnitStatus, BuildStatus } from './inventory-config';

export type OrderStatus = 'pending' | 'assembling' | 'checking' | 'packing' | 'packed' | 'shipped' | 'delivered' | 'held' | 'no-stock' | 'cancelled' | 'refunded' | 'returned' | 'archived';

export type DeliveryCarrier = 'DPD' | 'FedEx' | 'Parcelforce' | 'Royal Mail' | 'Other';
export type DeliveryType = 'standard' | 'next_day' | 'two_day' | 'express' | 'collection';

export type DPDService = 
  | 'next_day'
  | 'by_1030'
  | 'saturday_by_1030'
  | 'by_12'
  | 'sunday_by_12'
  | 'saturday_by_12'
  | 'saturday'
  | 'sunday';

export type UserRole = 'admin' | 'manager' | 'staff' | 'comms';

export type Department =
  | 'management'
  | 'assembler'
  | 'packing'
  | 'comms'
  | 'returns'
  | 'qa'
  | 'laptop'
  | 'gaming-pc'
  | 'projector'
  | 'pc-aio-mini'
  | 'monitor'
  | 'networking';

export const DEPARTMENT_CONFIG: Record<Department, {
  label: string;
  color: string;
  /** If set, this dept only sees orders whose category matches one of these values */
  categories?: string[];
}> = {
  management:  { label: 'Management',   color: 'bg-slate-100 text-slate-800 border-slate-300' },
  assembler:   { label: 'Assembler',     color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  packing:     { label: 'Packing Dept',  color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  comms:       { label: 'Comms Dept',    color: 'bg-purple-100 text-purple-800 border-purple-300' },
  returns:     { label: 'Returns Dept',  color: 'bg-rose-100 text-rose-800 border-rose-300' },
  qa:          { label: 'QA Dept',       color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  laptop:      { label: 'Laptop Dept',   color: 'bg-blue-100 text-blue-800 border-blue-300',    categories: ['LAPTOP'] },
  'gaming-pc': { label: 'Gaming PC Dept',color: 'bg-red-100 text-red-800 border-red-300',      categories: ['PC-GAMING'] },
  projector:   { label: 'Projector Dept',color: 'bg-amber-100 text-amber-800 border-amber-300', categories: ['PROJECTOR'] },
  'pc-aio-mini':{ label: 'PC-AIO-Mini Dept', color: 'bg-teal-100 text-teal-800 border-teal-300', categories: ['PC-AIO-MINI'] },
  monitor:     { label: 'Monitor Dept',  color: 'bg-green-100 text-green-800 border-green-300', categories: ['MONITOR'] },
  networking:  { label: 'Networking Dept', color: 'bg-orange-100 text-orange-800 border-orange-300', categories: ['NETWORKING'] },
};

export interface UserTarget {
  action: OrderStatus;
  dailyTarget: number;
}

export interface AppUser {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  roles: UserRole[];
  /** Primary department (kept for backwards compat) */
  department: Department;
  /** All departments this user belongs to — used for queue filtering */
  departments: Department[];
  pin?: string;
  targets?: UserTarget[];
}

/**
 * Buyer Inbox / email access is restricted to Comms and Admin only — not staff,
 * and not managers. Checks both the multi-role list and the legacy single role.
 */
export function canAccessInbox(
  user?: Pick<AppUser, 'role' | 'roles' | 'department' | 'departments'> | null,
): boolean {
  if (!user) return false;
  const roles = user.roles?.length ? user.roles : [user.role];
  if (roles.includes('admin') || roles.includes('comms')) return true;
  // Also honour anyone assigned to the Comms department, whatever their role.
  const depts = user.departments?.length ? user.departments : (user.department ? [user.department] : []);
  return depts.includes('comms');
}

// ── Access control (admin-configurable, see src/lib/access.ts) ──
// Per-resource rule. A user is granted if their role or department is listed, or
// they're in allowUsers; denyUsers is a hard revoke that overrides everything.
export interface ResourceRule {
  roles: UserRole[];
  departments: Department[];
  allowUsers: string[];
  denyUsers: string[];
}
export interface AccessConfig {
  version: number;
  resources: Record<string, ResourceRule>;
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
  orderNumber: string;
  buyerUsername: string;
  itemTitle: string;
  reason: string;
  notes: string;
  returnedAt: string;
  createdByUserId?: string;
  createdByUserName?: string;
  processedByUserId?: string;
  processedByUserName?: string;
  /** Department/user responsible for the return (for productivity tracking) */
  responsibleDepartment?: Department;
  responsibleUserId?: string;
  responsibleUserName?: string;
  refundAmount?: number;
  /** 'swap' = replacement sent ahead of receiving the faulty item back (open until it arrives) */
  status: 'pending' | 'received' | 'refunded' | 'rejected' | 'replacement' | 'swap';
  resolution?: 'refund' | 'replacement' | 'swap';
  returnTrackingNumber?: string;
  /** How the faulty item comes back for a swap: DPD driver collection or a return label */
  swapReturnMethod?: 'collection' | 'label';
  receivedNotes?: string;
  replacementItems?: ReplacementItem[];
  replacementOrderId?: string;
  /** URLs of uploaded images attached to the return */
  imageUrls?: string[];
}

export interface ReplacementItem {
  itemTitle: string;
  quantity: number;
  notes?: string;
  /** URLs of uploaded images for this replacement item */
  imageUrls?: string[];
}

export interface MissingItemRecord {
  id: string;
  orderId: string;
  salesRecordNumber: string;
  buyerUsername: string;
  itemTitle: string;
  /** Parts/accessories that were missed */
  missingParts: MissingPart[];
  notes: string;
  reportedAt: string;
  reportedByUserId?: string;
  reportedByUserName?: string;
  /** Department responsible for the error */
  responsibleDepartment?: Department;
  responsibleUserId?: string;
  responsibleUserName?: string;
  status: 'pending' | 'dispatched' | 'resolved';
  /** ID of the follow-up dispatch order created */
  dispatchOrderId?: string;
}

export interface MissingPart {
  description: string;
  quantity: number;
  notes?: string;
}

// ==================== INVENTORY ====================

/** A catalogued part/product definition (SKU). Spec lives in `attributes`. */
export interface InventoryPart {
  id: string;
  sku: string;
  name: string;
  category: string;                              // INVENTORY_CATEGORIES key
  tracking: StockTracking;
  attributes: Record<string, string | number>;
  /** Manufacturer/product barcode (EAN/UPC) for scan-to-receive */
  barcode?: string;
  /** Linked reference-catalog product — rich specs + image live in catalog_products */
  catalogProductId?: string;
  imageUrl?: string;
  lowStockThreshold?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Reference product from the scraped catalog (catalog_products). NOT physical stock. */
export interface CatalogProduct {
  id: string;
  source: string;
  category: string;                              // catalog category: cpu | memory | ...
  name: string;
  brand?: string;
  imageUrl?: string;
  sourceUrl?: string;
  msrp?: number;
  currency?: string;
  ratingCount?: number;
  specs: Record<string, string | number>;
}

/** A single physical serialized unit (laptop/PC/monitor). */
export interface StockUnit {
  id: string;
  partId: string;
  assetTag?: string;                             // serial / asset id
  grade?: string;
  status: StockUnitStatus;
  location?: string;
  conditionNotes?: string;
  attributes?: Record<string, string | number>;  // unit-specific config (installed RAM/SSD etc.)
  goodsReceiptId?: string;
  unitCost?: number;
  receivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Quantity-on-hand for a bulk part, per grade + location. */
export interface StockLevel {
  id: string;
  partId: string;
  grade?: string;
  location?: string;
  quantity: number;
  updatedAt: string;
}

export type GoodsReceiptStatus = 'draft' | 'posted';

export interface GoodsReceiptLine {
  id: string;
  /** When set (e.g. from a barcode scan), receive into this exact part instead of matching by spec */
  partId?: string;
  /** When received from the reference catalog, links the created part to it + carries name/image */
  catalogProductId?: string;
  catalogName?: string;
  catalogImageUrl?: string;
  category: string;
  tracking: StockTracking;
  attributes: Record<string, string | number>;
  grade?: string;
  quantity: number;
  unitCost?: number;
  location?: string;
  notes?: string;
}

/** One allocated part within a build (BOM line). */
export interface BuildLine {
  partId: string;
  category: string;
  description: string;          // snapshot of the part spec at allocation time
  quantity: number;             // bulk quantity
  stockUnitId?: string;         // specific serialized unit (e.g. the base laptop)
}

/**
 * A component swap recorded during assembly: parts pulled OUT of a unit (returned
 * to stock) and the replacement put IN (consumed from stock). E.g. 2×8GB out,
 * 1×16GB in. Inventory is adjusted when the swap is recorded.
 */
export interface BuildSwap {
  id: string;
  category: string;                                 // INVENTORY_CATEGORIES key
  outLabel: string;                                 // e.g. "8GB"
  outAttributes: Record<string, string | number>;
  outQty: number;
  inLabel: string;                                  // e.g. "16GB"
  inAttributes: Record<string, string | number>;
  inQty: number;
  at: string;
  byId?: string;
  byName?: string;
}

/**
 * A build links an order to the parts allocated to it. While `reserved` the parts
 * are on hold (assembling); when the order reaches packed the build is `consumed`
 * and stock is deducted (negative allowed).
 */
export interface Build {
  id: string;
  orderId: string;
  status: BuildStatus;
  lines: BuildLine[];
  swaps?: BuildSwap[];          // component swaps recorded during assembly
  notes?: string;
  createdById?: string;
  createdByName?: string;
  reservedAt?: string;
  consumedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A pallet / delivery received into the warehouse. */
export interface GoodsReceipt {
  id: string;
  reference: string;
  supplier?: string;
  status: GoodsReceiptStatus;
  lines: GoodsReceiptLine[];
  totalCost?: number;
  notes?: string;
  receivedAt: string;
  receivedById?: string;
  receivedByName?: string;
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== SUPPORT TICKETS ====================

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketContactMethod = 'phone' | 'email' | 'ebay_message';

export const TICKET_STATUS_CONFIG: Record<TicketStatus, { label: string; color: string }> = {
  open:        { label: 'Open',        color: 'bg-blue-100 text-blue-800 border-blue-300' },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  waiting:     { label: 'Waiting',     color: 'bg-purple-100 text-purple-800 border-purple-300' },
  resolved:    { label: 'Resolved',    color: 'bg-green-100 text-green-800 border-green-300' },
  closed:      { label: 'Closed',      color: 'bg-slate-100 text-slate-600 border-slate-300' },
};

export const TICKET_PRIORITY_CONFIG: Record<TicketPriority, { label: string; color: string }> = {
  low:    { label: 'Low',    color: 'bg-slate-100 text-slate-600 border-slate-300' },
  normal: { label: 'Normal', color: 'bg-sky-100 text-sky-700 border-sky-300' },
  high:   { label: 'High',   color: 'bg-orange-100 text-orange-800 border-orange-300' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-800 border-red-300' },
};

export interface TicketActivity {
  at: string;
  byId?: string;
  byName?: string;
  /** note = free comment; status = status change; assign = (re)assignment; create = ticket created */
  type: 'note' | 'status' | 'assign' | 'create';
  text: string;
}

export interface TicketRecord {
  id: string;
  subject: string;
  body?: string;
  /** Reason category, e.g. wrong-item | damaged | not-received | other */
  category?: string;
  status: TicketStatus;
  priority: TicketPriority;
  /** Responsible department; anyone in it sees the ticket */
  department?: Department;
  /** Optional specific person within the department */
  assigneeUserId?: string;
  assigneeName?: string;
  /** How the customer prefers to be contacted */
  contactMethod?: TicketContactMethod;
  contactValue?: string;
  // linkage
  orderId?: string;
  salesRecordNumber?: string;
  orderNumber?: string;
  ebayConversationId?: string;
  buyerUsername?: string;
  buyerName?: string;
  itemTitle?: string;
  // audit
  createdById?: string;
  createdByName?: string;
  activity: TicketActivity[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface EodReport {
  date: string;
  events: EodEvent[];
  totalShipped: number;
  totalPacked: number;
  totalRevenue: number;
}

export type PackagingStage = 'assembling' | 'checking' | 'packing';

export interface OrderNote {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export interface Order {
  id: string;
  salesRecordNumber: string;
  orderNumber: string;
  amazonOrderId?: string; // For Amazon orders
  buyerUsername: string;
  buyerName: string;
  buyerEmail: string;
  buyerNote: string;
  // Buyer / billing address — the buyer's real address. For GSP orders this is the
  // overseas destination, distinct from the UK "Post to" hub address below.
  buyerAddress1?: string;
  buyerAddress2?: string;
  buyerCity?: string;
  buyerCounty?: string;
  buyerPostcode?: string;
  buyerCountry?: string;
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
  // Priority system (1=highest, 5=lowest)
  priority: number;
  // Number of boxes for shipping
  numberOfBoxes: number;
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
  // Status - always pending regardless of dispatched
  status: OrderStatus;
  category: string;
  comments: string;
  notes?: OrderNote[];
  // Shipping label
  labelQty: number;
  // GSP / international
  isGSP: boolean;
  // Extended liability
  extendedLiability: boolean;
  // Return tracking
  returnId?: string;
  // Printed label storage
  labelPrintedAt?: string;
  labelCarrier?: string;
  labelData?: string[]; // base64 PDF(s)
  // Metadata
  importedAt: string;
  batchId: string;
  // Soft delete
  deletedAt?: string;
  // Replacement linkage
  isReplacement?: boolean;
  originalOrderId?: string;
  // Preprinted security-barcode label attached to the physical build at assembly.
  // Scanned again at packing to pull the order up. One barcode ↔ one order.
  securityBarcode?: string;
  securityBarcodeAt?: string;   // when it was first attached
  // Advisory assembly lock — held while an assembler has the build open, so two
  // assemblers don't work the same order. Auto-expires (see LOCK_TTL in store).
  lockedById?: string;
  lockedByName?: string;
  lockedAt?: string;
}

export interface Batch {
  id: string;
  name: string;
  importedAt: string;
  orderCount: number;
  source: 'ebay' | 'backmarket' | 'amazon' | 'temu' | 'onbuy' | 'manual';
}

// HR Module Types
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half-day' | 'wfh';

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string; // ISO date string YYYY-MM-DD
  clockIn?: string; // ISO timestamp
  clockOut?: string; // ISO timestamp
  status: AttendanceStatus;
  notes?: string;
  approvedBy?: string; // userId of approver
  approvedAt?: string;
}

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'maternity' | 'paternity' | 'bereavement' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  days: number;
  reason: string;
  status: LeaveStatus;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface LeaveBalance {
  userId: string;
  year: number;
  annual: number; // days available
  sick: number; // days available (may be unlimited, but track usage)
  unpaid: number; // unlimited, but track for reporting
  used: {
    annual: number;
    sick: number;
    unpaid: number;
    other: number;
  };
}

// --- eBay Listings ---

export type EbayListingCondition =
  | 'NEW'
  | 'LIKE_NEW'
  | 'VERY_GOOD'
  | 'GOOD'
  | 'ACCEPTABLE';

export type EbayListingFormat = 'FIXED_PRICE' | 'AUCTION';

export interface EbayBusinessPolicy {
  policyId: string;
  name: string;
  policyType: 'PAYMENT' | 'RETURN_POLICY' | 'FULFILLMENT';
}

export interface EbayInventoryLocation {
  merchantLocationKey: string;
  name: string;
  merchantLocationStatus: 'ENABLED' | 'DISABLED';
}

export interface VariationPayload {
  sku: string;
  aspectValues: Record<string, string>;
  price: number;
  quantity: number;
  imageUrl?: string;
}

export interface CreateListingPayload {
  sku: string;
  title: string;
  description: string;
  condition: EbayListingCondition;
  quantity: number;
  imageUrls: string[];
  aspects: Record<string, string[]>;
  categoryId: string;
  format: EbayListingFormat;
  price: number;
  merchantLocationKey: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  fulfillmentPolicyId: string;
  // Variation mode only
  variations?: VariationPayload[];
  varyingAspects?: string[];
}

export const LISTING_CONDITION_LABELS: Record<EbayListingCondition, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like New',
  VERY_GOOD: 'Very Good',
  GOOD: 'Good',
  ACCEPTABLE: 'Acceptable',
};

export const ORDER_STATUS_CONFIG: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  assembling: { label: 'Assembling', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  checking: { label: 'Checking', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  packing: { label: 'Packing', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  packed: { label: 'Packed', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  shipped: { label: 'Shipped', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800 border-green-300' },
  held: { label: 'On Hold', color: 'bg-red-100 text-red-800 border-red-300' },
  'no-stock': { label: 'No Stock', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-800 border-gray-300' },
  refunded: { label: 'Refunded', color: 'bg-orange-100 text-orange-800 border-orange-300' },
  returned: { label: 'Returned', color: 'bg-rose-100 text-rose-800 border-rose-300' },
  archived: { label: 'Archived', color: 'bg-slate-100 text-slate-800 border-slate-300' },
};

export const PACKAGING_STAGES: { stage: PackagingStage; next: OrderStatus; label: string; description: string }[] = [
  { stage: 'assembling', next: 'checking', label: 'Assembling', description: 'Gather items, accessories, and prepare the order' },
  { stage: 'checking', next: 'packing', label: 'Checking', description: 'Quality check, verify item matches order, test functionality' },
  { stage: 'packing', next: 'packed', label: 'Packing', description: 'Box, wrap, seal, and label the package' },
];
