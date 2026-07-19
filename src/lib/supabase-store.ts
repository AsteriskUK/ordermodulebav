import { supabase } from './supabase-client';
import { Order, Batch, AppUser, AttendanceRecord, LeaveRequest, LeaveBalance, EodEvent, ReturnRecord, TicketRecord, Department, TicketStatus, TicketPriority, TicketContactMethod, TicketActivity, MissingItemRecord, MissingPart, InventoryPart, StockUnit, StockLevel, GoodsReceipt, GoodsReceiptLine, GoodsReceiptStatus, Build, BuildLine, BuildSwap, AccessConfig } from './types';
import { StockTracking, StockUnitStatus, BuildStatus } from './inventory-config';
import { SettingsValues, SETTINGS_STORAGE_KEY } from './settings';
import { SettingValue } from './settings-schema';

// Helper to check if string is valid UUID
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ==================== USERS ====================

export async function fetchUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true);
  
  if (error) {
    console.error('Error fetching users:', error);
    return [];
  }
  
  return data?.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    roles: u.roles || [u.role],
    department: u.department,
    departments: u.departments || [u.department],
    pin: u.pin,
  })) || [];
}

export async function syncUser(user: AppUser): Promise<void> {
  // Skip if user ID is not valid UUID
  if (!isValidUUID(user.id)) {
    console.log('Skipping sync for user with invalid ID:', user.id);
    return;
  }
  
  const { error } = await supabase
    .from('users')
    .upsert({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roles: user.roles,
      department: user.department,
      departments: user.departments,
      pin: user.pin,
      is_active: true,
    });
  
  if (error) {
    console.error('Error syncing user:', JSON.stringify(error, null, 2));
    console.error('User data:', { id: user.id, name: user.name, email: user.email });
  }
}

export async function deleteUserFromSupabase(userId: string): Promise<void> {
  // Skip if user ID is not valid UUID
  if (!isValidUUID(userId)) {
    console.log('Skipping delete for user with invalid ID:', userId);
    return;
  }
  
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', userId);
  
  if (error) console.error('Error deleting user from Supabase:', error);
}

// ==================== BATCHES ====================

export async function fetchBatches(): Promise<Batch[]> {
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .order('imported_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching batches:', error);
    return [];
  }
  
  return data?.map(b => ({
    id: b.id,
    name: b.name,
    source: b.source,
    orderCount: b.order_count,
    importedAt: b.imported_at,
  })) || [];
}

export async function syncBatch(batch: Batch, importedBy?: string): Promise<void> {
  // Skip if batch ID is not valid UUID
  if (!isValidUUID(batch.id)) {
    console.log('Skipping sync for batch with invalid ID:', batch.id);
    return;
  }
  
  const { error } = await supabase
    .from('batches')
    .upsert({
      id: batch.id,
      name: batch.name,
      source: batch.source,
      order_count: batch.orderCount,
      imported_at: batch.importedAt,
      imported_by: importedBy,
    });
  
  if (error) {
    console.error('Error syncing batch:', JSON.stringify(error, null, 2));
    console.error('Batch data:', { id: batch.id, name: batch.name });
  }
}

// ==================== ORDERS ====================

export async function fetchOrders(): Promise<Order[]> {
  // Only the active working set — archived orders are history (viewed via the
  // Historical Orders page, which queries the DB directly). Loading them here
  // just bloats the store (Supabase caps a response at 1000 rows anyway).
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_notes(*)')
    .neq('status', 'archived')
    .order('imported_at', { ascending: false })
    .limit(3000);

  if (error) {
    // Supabase error fields are non-enumerable, so logging the object prints "{}".
    // Pull them out explicitly so the real cause (timeout, RLS, network) is visible.
    console.error('Error fetching orders:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return [];
  }

  return data?.map(o => ({
    id: o.id,
    salesRecordNumber: o.sales_record_number,
    orderNumber: o.order_number,
    batchId: o.batch_id,
    buyerUsername: o.buyer_username,
    buyerName: o.buyer_name,
    buyerEmail: o.buyer_email,
    buyerNote: o.buyer_note,
    postToName: o.post_to_name,
    postToPhone: o.post_to_phone,
    postToAddress1: o.post_to_address1,
    postToAddress2: o.post_to_address2,
    postToCity: o.post_to_city,
    postToCounty: o.post_to_county,
    postToPostcode: o.post_to_postcode,
    postToCountry: o.post_to_country,
    isGSP: o.is_gsp,
    extendedLiability: o.extended_liability,
    amazonOrderId: o.amazon_order_id,
    itemNumber: o.item_number,
    itemTitle: o.item_title,
    customLabel: o.custom_label,
    variation: o.variation,
    quantity: o.quantity,
    category: o.category,
    soldFor: parseFloat(o.sold_for) || 0,
    postageAndPackaging: parseFloat(o.postage_and_packaging) || 0,
    totalPrice: parseFloat(o.total_price) || 0,
    deliveryCarrier: o.delivery_carrier,
    deliveryType: o.delivery_type,
    trackingNumber: o.tracking_number,
    deliveryService: o.delivery_service,
    numberOfBoxes: o.number_of_boxes,
    labelQty: o.label_qty,
    priority: o.priority,
    status: o.status,
    comments: o.comments,
    saleDate: o.sale_date,
    paidOnDate: o.paid_on_date,
    postByDate: o.post_by_date,
    dispatchedOnDate: o.dispatched_on_date,
    maxEstimatedDeliveryDate: o.metadata?.max_estimated_delivery_date,
    importedAt: o.imported_at,
    returnId: o.return_id,
    labelPrintedAt: o.label_printed_at,
    labelCarrier: o.label_carrier,
    labelData: o.label_data,
    isReplacement: o.metadata?.is_replacement,
    originalOrderId: o.metadata?.original_order_id,
    securityBarcode: o.metadata?.security_barcode,
    securityBarcodeAt: o.metadata?.security_barcode_at,
    lockedById: o.metadata?.locked_by_id,
    lockedByName: o.metadata?.locked_by_name,
    lockedAt: o.metadata?.locked_at,
    pickedAt: o.metadata?.picked_at,
    pickedById: o.metadata?.picked_by_id,
    pickedByName: o.metadata?.picked_by_name,
    packChecklist: o.metadata?.pack_checklist,
    buyerAddress1: o.metadata?.buyer_address1,
    buyerAddress2: o.metadata?.buyer_address2,
    buyerCity: o.metadata?.buyer_city,
    buyerCounty: o.metadata?.buyer_county,
    buyerPostcode: o.metadata?.buyer_postcode,
    buyerCountry: o.metadata?.buyer_country,
    notes: o.order_notes?.map((n: any) => ({
      id: n.id,
      authorId: n.author_id,
      authorName: n.author_name,
      text: n.text,
      createdAt: n.created_at,
    })) || [],
  })) || [];
}

export async function syncOrder(order: Order): Promise<void> {
  // Skip if order ID is not valid UUID
  if (!isValidUUID(order.id)) {
    console.log('Skipping sync for order with invalid ID:', order.id);
    return;
  }
  // Skip if batch_id is not valid UUID
  if (order.batchId && !isValidUUID(order.batchId)) {
    console.log('Skipping sync - invalid batch ID:', order.batchId);
    return;
  }
  
  const { error } = await supabase
    .from('orders')
    .upsert({
      id: order.id,
      sales_record_number: order.salesRecordNumber,
      order_number: order.orderNumber,
      batch_id: order.batchId,
      buyer_username: order.buyerUsername,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      buyer_note: order.buyerNote,
      post_to_name: order.postToName,
      post_to_phone: order.postToPhone,
      post_to_address1: order.postToAddress1,
      post_to_address2: order.postToAddress2,
      post_to_city: order.postToCity,
      post_to_county: order.postToCounty,
      post_to_postcode: order.postToPostcode,
      post_to_country: order.postToCountry,
      is_gsp: order.isGSP,
      item_number: order.itemNumber,
      item_title: order.itemTitle,
      custom_label: order.customLabel,
      variation: order.variation,
      quantity: order.quantity,
      category: order.category,
      sold_for: order.soldFor,
      postage_and_packaging: order.postageAndPackaging,
      total_price: order.totalPrice,
      delivery_carrier: order.deliveryCarrier,
      delivery_type: order.deliveryType,
      tracking_number: order.trackingNumber,
      delivery_service: order.deliveryService,
      number_of_boxes: order.numberOfBoxes,
      label_qty: order.labelQty,
      priority: order.priority,
      status: order.status,
      comments: order.comments,
      sale_date: order.saleDate,
      paid_on_date: order.paidOnDate,
      post_by_date: order.postByDate,
      dispatched_on_date: order.dispatchedOnDate,
      imported_at: order.importedAt,
      return_id: order.returnId,
      // deleted_at: order.deletedAt ?? null, // requires migration: ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      metadata: {
        is_replacement: order.isReplacement,
        original_order_id: order.originalOrderId,
        security_barcode: order.securityBarcode,
        security_barcode_at: order.securityBarcodeAt,
        locked_by_id: order.lockedById,
        locked_by_name: order.lockedByName,
        locked_at: order.lockedAt,
        picked_at: order.pickedAt,
        picked_by_id: order.pickedById,
        picked_by_name: order.pickedByName,
        pack_checklist: order.packChecklist,
        cleaned_at: order.cleanedAt,
        cleaned_by_id: order.cleanedById,
        cleaned_by_name: order.cleanedByName,
        vinyl_applied_at: order.vinylAppliedAt,
        vinyl_applied_by_id: order.vinylAppliedById,
        vinyl_applied_by_name: order.vinylAppliedByName,
        buyer_address1: order.buyerAddress1,
        buyer_address2: order.buyerAddress2,
        buyer_city: order.buyerCity,
        buyer_county: order.buyerCounty,
        buyer_postcode: order.buyerPostcode,
        buyer_country: order.buyerCountry,
        max_estimated_delivery_date: order.maxEstimatedDeliveryDate,
      },
      // label_printed_at: order.labelPrintedAt, // TODO: Add column to Supabase
      // label_carrier: order.labelCarrier, // TODO: Add column to Supabase
      // label_data: order.labelData, // TODO: Add column to Supabase
    });
  
  if (error) {
    console.error('Error syncing order:', JSON.stringify(error, null, 2));
    console.error('Order data:', { id: order.id, salesRecordNumber: order.salesRecordNumber, batchId: order.batchId });
    return;
  }

  // Sync order notes
  if (order.notes && order.notes.length > 0) {
    const { error: deleteError } = await supabase
      .from('order_notes')
      .delete()
      .eq('order_id', order.id);
    if (deleteError) {
      console.error('Error deleting order notes before sync:', JSON.stringify(deleteError, null, 2));
    }

    // Upsert (not insert) so concurrent syncOrder calls for the same order can't
    // collide on order_notes_pkey — a re-sync of the same note just updates it.
    const { error: notesError } = await supabase
      .from('order_notes')
      .upsert(order.notes.map((n) => ({
        id: isValidUUID(n.id) ? n.id : undefined,
        order_id: order.id,
        author_id: n.authorId && isValidUUID(n.authorId) ? n.authorId : undefined,
        author_name: n.authorName,
        text: n.text,
        created_at: n.createdAt,
      })), { onConflict: 'id' });
    if (notesError) {
      console.error('Error syncing order notes:', JSON.stringify(notesError, null, 2));
    }
  }
}

export async function softDeleteOrderInSupabase(orderId: string, _deletedAt: string): Promise<void> {
  // No-op until migration is run: ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  // Once added, replace with: await supabase.from('orders').update({ deleted_at: _deletedAt }).eq('id', orderId);
  void orderId;
}

export async function hardDeleteOrderFromSupabase(orderId: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', orderId);
  if (error) console.error('Error hard-deleting order:', error);
}

// ==================== ATTENDANCE ====================

export async function fetchAttendance(): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .order('date', { ascending: false });
  
  if (error) {
    console.error('Error fetching attendance:', error);
    return [];
  }
  
  return data?.map(r => ({
    id: r.id,
    userId: r.user_id,
    date: r.date,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    status: r.status,
    notes: r.notes,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
  })) || [];
}

export async function syncAttendance(record: AttendanceRecord): Promise<void> {
  // Skip old format records that don't have valid UUIDs
  if (!isValidUUID(record.id)) {
    console.log('Skipping sync for old-format record:', record.id);
    return;
  }
  
  const { error } = await supabase
    .from('attendance_records')
    .upsert({
      id: record.id,
      user_id: record.userId,
      date: record.date,
      clock_in: record.clockIn,
      clock_out: record.clockOut,
      status: record.status,
      notes: record.notes,
      approved_by: record.approvedBy,
      approved_at: record.approvedAt,
    });
  
  if (error) {
    console.error('Error syncing attendance:', JSON.stringify(error, null, 2));
    throw error;
  }
}

// ==================== LEAVE REQUESTS ====================

export async function fetchLeaveRequests(): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .order('requested_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching leave requests:', error);
    return [];
  }
  
  return data?.map(r => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    startDate: r.start_date,
    endDate: r.end_date,
    days: r.days,
    reason: r.reason,
    status: r.status,
    requestedAt: r.requested_at,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    rejectionReason: r.rejection_reason,
  })) || [];
}

export async function syncLeaveRequest(request: LeaveRequest): Promise<void> {
  const { error } = await supabase
    .from('leave_requests')
    .upsert({
      id: request.id,
      user_id: request.userId,
      type: request.type,
      start_date: request.startDate,
      end_date: request.endDate,
      days: request.days,
      reason: request.reason,
      status: request.status,
      requested_at: request.requestedAt,
      approved_by: request.approvedBy,
      approved_at: request.approvedAt,
      rejection_reason: request.rejectionReason,
    });
  
  if (error) console.error('Error syncing leave request:', error);
}

// ==================== LEAVE BALANCES ====================

export async function fetchLeaveBalances(): Promise<LeaveBalance[]> {
  const { data, error } = await supabase
    .from('leave_balances')
    .select('*');
  
  if (error) {
    console.error('Error fetching leave balances:', error);
    return [];
  }
  
  return data?.map(b => ({
    userId: b.user_id,
    year: b.year,
    annual: b.annual_days,
    sick: b.sick_days,
    unpaid: b.unpaid_days,
    used: {
      annual: b.used_annual,
      sick: b.used_sick,
      unpaid: b.used_unpaid,
      other: b.used_other,
    },
  })) || [];
}

export async function syncLeaveBalance(balance: LeaveBalance): Promise<void> {
  const { error } = await supabase
    .from('leave_balances')
    .upsert({
      user_id: balance.userId,
      year: balance.year,
      annual_days: balance.annual,
      sick_days: balance.sick,
      unpaid_days: balance.unpaid,
      used_annual: balance.used.annual,
      used_sick: balance.used.sick,
      used_unpaid: balance.used.unpaid,
      used_other: balance.used.other,
    });
  
  if (error) console.error('Error syncing leave balance:', error);
}

// ==================== RETURNS ====================

export async function syncReturn(ret: ReturnRecord): Promise<void> {
  if (!isValidUUID(ret.id)) {
    console.log('Skipping sync for return with invalid ID:', ret.id);
    return;
  }
  const metadata = Object.fromEntries(
    Object.entries({
      resolution: ret.resolution,
      replacement_items: ret.replacementItems,
      replacement_order_id: ret.replacementOrderId,
      return_tracking_number: ret.returnTrackingNumber,
      swap_return_method: ret.swapReturnMethod,
      received_notes: ret.receivedNotes,
      image_urls: ret.imageUrls,
      ebay_return_id: ret.ebayReturnId,
      platform: ret.platform,
    }).filter(([, v]) => v !== undefined)
  );

  const { error } = await supabase
    .from('returns')
    .upsert({
      id: ret.id,
      order_id: ret.orderId,
      sales_record_number: ret.salesRecordNumber,
      order_number: ret.orderNumber,
      reason: ret.reason,
      status: ret.status,
      notes: ret.notes,
      returned_at: ret.returnedAt,
      processed_by_user_id: ret.processedByUserId,
      processed_by_user_name: ret.processedByUserName,
      refund_amount: ret.refundAmount,
      metadata,
      responsible_department: ret.responsibleDepartment,
      responsible_user_id: ret.responsibleUserId,
      responsible_user_name: ret.responsibleUserName,
    });

  if (error) {
    console.error('Error syncing return:', JSON.stringify(error, null, 2));
    console.error('Return data:', { id: ret.id, status: ret.status, metadata });
  }
}

export async function fetchReturns(): Promise<ReturnRecord[]> {
  const { data, error } = await supabase
    .from('returns')
    .select('*')
    .order('returned_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching returns:', error);
    return [];
  }
  
  return data?.map(r => ({
    id: r.id,
    orderId: r.order_id,
    salesRecordNumber: r.sales_record_number,
    orderNumber: r.order_number,
    buyerUsername: r.buyer_username,
    itemTitle: r.item_title,
    reason: r.reason,
    notes: r.notes,
    returnedAt: r.returned_at,
    processedByUserId: r.processed_by_user_id,
    processedByUserName: r.processed_by_user_name,
    refundAmount: r.refund_amount,
    status: r.status,
    resolution: r.metadata?.resolution,
    replacementItems: r.metadata?.replacement_items,
    replacementOrderId: r.metadata?.replacement_order_id,
    returnTrackingNumber: r.metadata?.return_tracking_number,
    swapReturnMethod: r.metadata?.swap_return_method,
    receivedNotes: r.metadata?.received_notes,
    imageUrls: r.metadata?.image_urls,
    ebayReturnId: r.metadata?.ebay_return_id,
    amazonRmaId: r.metadata?.amazon_rma_id,
    asin: r.metadata?.asin,
    sku: r.metadata?.sku,
    platform: r.metadata?.platform,
    responsibleDepartment: r.responsible_department,
    responsibleUserId: r.responsible_user_id,
    responsibleUserName: r.responsible_user_name,
  })) || [];
}

// ==================== TICKETS ====================

export async function syncTicket(ticket: TicketRecord): Promise<void> {
  if (!isValidUUID(ticket.id)) {
    console.log('Skipping sync for ticket with invalid ID:', ticket.id);
    return;
  }
  const { error } = await supabase
    .from('tickets')
    .upsert({
      id: ticket.id,
      subject: ticket.subject,
      body: ticket.body,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      department: ticket.department,
      assignee_user_id: ticket.assigneeUserId,
      assignee_name: ticket.assigneeName,
      contact_method: ticket.contactMethod,
      contact_value: ticket.contactValue,
      order_id: ticket.orderId,
      sales_record_number: ticket.salesRecordNumber,
      order_number: ticket.orderNumber,
      ebay_conversation_id: ticket.ebayConversationId,
      buyer_username: ticket.buyerUsername,
      buyer_name: ticket.buyerName,
      item_title: ticket.itemTitle,
      created_by_id: ticket.createdById,
      created_by_name: ticket.createdByName,
      activity: ticket.activity ?? [],
      created_at: ticket.createdAt,
      resolved_at: ticket.resolvedAt,
    });

  if (error) console.error('Error syncing ticket:', JSON.stringify(error, null, 2));
}

export async function deleteTicketFromSupabase(ticketId: string): Promise<void> {
  if (!isValidUUID(ticketId)) return;
  const { error } = await supabase.from('tickets').delete().eq('id', ticketId);
  if (error) console.error('Error deleting ticket:', error);
}

export async function fetchTickets(): Promise<TicketRecord[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching tickets:', error);
    return [];
  }

  return data?.map((t) => ({
    id: t.id,
    subject: t.subject,
    body: t.body ?? undefined,
    category: t.category ?? undefined,
    status: (t.status ?? 'open') as TicketStatus,
    priority: (t.priority ?? 'normal') as TicketPriority,
    department: (t.department ?? undefined) as Department | undefined,
    assigneeUserId: t.assignee_user_id ?? undefined,
    assigneeName: t.assignee_name ?? undefined,
    contactMethod: (t.contact_method ?? undefined) as TicketContactMethod | undefined,
    contactValue: t.contact_value ?? undefined,
    orderId: t.order_id ?? undefined,
    salesRecordNumber: t.sales_record_number ?? undefined,
    orderNumber: t.order_number ?? undefined,
    ebayConversationId: t.ebay_conversation_id ?? undefined,
    buyerUsername: t.buyer_username ?? undefined,
    buyerName: t.buyer_name ?? undefined,
    itemTitle: t.item_title ?? undefined,
    createdById: t.created_by_id ?? undefined,
    createdByName: t.created_by_name ?? undefined,
    activity: (t.activity ?? []) as TicketActivity[],
    createdAt: t.created_at,
    updatedAt: t.updated_at ?? t.created_at,
    resolvedAt: t.resolved_at ?? undefined,
  })) || [];
}

// ==================== MISSING ITEMS ====================

export async function syncMissingItem(m: MissingItemRecord): Promise<void> {
  if (!isValidUUID(m.id)) {
    console.log('Skipping sync for missing item with invalid ID:', m.id);
    return;
  }
  const { error } = await supabase
    .from('missing_items')
    .upsert({
      id: m.id,
      order_id: m.orderId,
      sales_record_number: m.salesRecordNumber,
      buyer_username: m.buyerUsername,
      item_title: m.itemTitle,
      missing_parts: m.missingParts ?? [],
      notes: m.notes,
      status: m.status,
      reported_at: m.reportedAt,
      reported_by_user_id: m.reportedByUserId,
      reported_by_user_name: m.reportedByUserName,
      responsible_department: m.responsibleDepartment,
      responsible_user_id: m.responsibleUserId,
      responsible_user_name: m.responsibleUserName,
      dispatch_order_id: m.dispatchOrderId,
    });
  if (error) console.error('Error syncing missing item:', JSON.stringify(error, null, 2));
}

export async function fetchMissingItems(): Promise<MissingItemRecord[]> {
  const { data, error } = await supabase
    .from('missing_items')
    .select('*')
    .order('reported_at', { ascending: false });

  if (error) {
    console.error('Error fetching missing items:', error);
    return [];
  }

  return data?.map((m) => ({
    id: m.id,
    orderId: m.order_id,
    salesRecordNumber: m.sales_record_number,
    buyerUsername: m.buyer_username,
    itemTitle: m.item_title,
    missingParts: (m.missing_parts ?? []) as MissingPart[],
    notes: m.notes ?? '',
    reportedAt: m.reported_at,
    reportedByUserId: m.reported_by_user_id ?? undefined,
    reportedByUserName: m.reported_by_user_name ?? undefined,
    responsibleDepartment: (m.responsible_department ?? undefined) as Department | undefined,
    responsibleUserId: m.responsible_user_id ?? undefined,
    responsibleUserName: m.responsible_user_name ?? undefined,
    status: (m.status ?? 'pending') as MissingItemRecord['status'],
    dispatchOrderId: m.dispatch_order_id ?? undefined,
  })) || [];
}

// ==================== INVENTORY ====================

export async function syncInventoryPart(p: InventoryPart): Promise<void> {
  if (!isValidUUID(p.id)) return;
  const { error } = await supabase.from('inventory_parts').upsert({
    id: p.id, sku: p.sku, name: p.name, category: p.category, tracking: p.tracking,
    attributes: p.attributes ?? {}, barcode: p.barcode, low_stock_threshold: p.lowStockThreshold, notes: p.notes,
    catalog_product_id: isValidUUID(p.catalogProductId ?? '') ? p.catalogProductId : null,
    image_url: p.imageUrl,
    created_at: p.createdAt,
  });
  if (error) console.error('Error syncing inventory part:', JSON.stringify(error, null, 2));
}

export async function fetchInventoryParts(): Promise<InventoryPart[]> {
  const { data, error } = await supabase.from('inventory_parts').select('*').order('created_at', { ascending: false });
  if (error) { console.warn('[inventory] table not ready yet (run migration) — fetching inventory parts:', error?.message || error); return []; }
  return data?.map((p) => ({
    id: p.id, sku: p.sku ?? '', name: p.name, category: p.category,
    tracking: (p.tracking ?? 'bulk') as StockTracking,
    attributes: (p.attributes ?? {}) as Record<string, string | number>,
    barcode: p.barcode ?? undefined,
    catalogProductId: p.catalog_product_id ?? undefined,
    imageUrl: p.image_url ?? undefined,
    lowStockThreshold: p.low_stock_threshold ?? undefined, notes: p.notes ?? undefined,
    createdAt: p.created_at, updatedAt: p.updated_at ?? p.created_at,
  })) || [];
}

export async function syncStockUnit(u: StockUnit): Promise<void> {
  if (!isValidUUID(u.id)) return;
  const { error } = await supabase.from('stock_units').upsert({
    id: u.id, part_id: u.partId, asset_tag: u.assetTag, grade: u.grade, status: u.status,
    location: u.location, condition_notes: u.conditionNotes, attributes: u.attributes ?? {},
    goods_receipt_id: isValidUUID(u.goodsReceiptId ?? '') ? u.goodsReceiptId : null,
    unit_cost: u.unitCost, received_at: u.receivedAt, created_at: u.createdAt,
  });
  if (error) console.error('Error syncing stock unit:', JSON.stringify(error, null, 2));
}

export async function fetchStockUnits(): Promise<StockUnit[]> {
  const { data, error } = await supabase.from('stock_units').select('*').order('created_at', { ascending: false });
  if (error) { console.warn('[inventory] table not ready yet (run migration) — fetching stock units:', error?.message || error); return []; }
  return data?.map((u) => ({
    id: u.id, partId: u.part_id, assetTag: u.asset_tag ?? undefined, grade: u.grade ?? undefined,
    status: (u.status ?? 'in_stock') as StockUnitStatus, location: u.location ?? undefined,
    conditionNotes: u.condition_notes ?? undefined,
    attributes: (u.attributes ?? {}) as Record<string, string | number>,
    goodsReceiptId: u.goods_receipt_id ?? undefined, unitCost: u.unit_cost ?? undefined,
    receivedAt: u.received_at ?? undefined, createdAt: u.created_at, updatedAt: u.updated_at ?? u.created_at,
  })) || [];
}

export async function syncStockLevel(l: StockLevel): Promise<void> {
  if (!isValidUUID(l.id)) return;
  const { error } = await supabase.from('stock_levels').upsert({
    id: l.id, part_id: l.partId, grade: l.grade, location: l.location, quantity: l.quantity,
  });
  if (error) console.error('Error syncing stock level:', JSON.stringify(error, null, 2));
}

export async function fetchStockLevels(): Promise<StockLevel[]> {
  const { data, error } = await supabase.from('stock_levels').select('*');
  if (error) { console.warn('[inventory] table not ready yet (run migration) — fetching stock levels:', error?.message || error); return []; }
  return data?.map((l) => ({
    id: l.id, partId: l.part_id, grade: l.grade ?? undefined, location: l.location ?? undefined,
    quantity: l.quantity ?? 0, updatedAt: l.updated_at ?? new Date().toISOString(),
  })) || [];
}

export async function syncGoodsReceipt(r: GoodsReceipt): Promise<void> {
  if (!isValidUUID(r.id)) return;
  const { error } = await supabase.from('goods_receipts').upsert({
    id: r.id, reference: r.reference, supplier: r.supplier, status: r.status,
    lines: r.lines ?? [], total_cost: r.totalCost, notes: r.notes,
    received_at: r.receivedAt, received_by_id: r.receivedById, received_by_name: r.receivedByName,
    posted_at: r.postedAt, created_at: r.createdAt,
  });
  if (error) console.error('Error syncing goods receipt:', JSON.stringify(error, null, 2));
}

export async function fetchGoodsReceipts(): Promise<GoodsReceipt[]> {
  const { data, error } = await supabase.from('goods_receipts').select('*').order('received_at', { ascending: false });
  if (error) { console.warn('[inventory] table not ready yet (run migration) — fetching goods receipts:', error?.message || error); return []; }
  return data?.map((r) => ({
    id: r.id, reference: r.reference ?? '', supplier: r.supplier ?? undefined,
    status: (r.status ?? 'draft') as GoodsReceiptStatus,
    lines: (r.lines ?? []) as GoodsReceiptLine[], totalCost: r.total_cost ?? undefined,
    notes: r.notes ?? undefined, receivedAt: r.received_at, receivedById: r.received_by_id ?? undefined,
    receivedByName: r.received_by_name ?? undefined, postedAt: r.posted_at ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at ?? r.created_at,
  })) || [];
}

export async function syncBuild(b: Build): Promise<void> {
  if (!isValidUUID(b.id)) return;
  const row: Record<string, unknown> = {
    id: b.id, order_id: b.orderId, status: b.status, lines: b.lines ?? [], swaps: b.swaps ?? [], notes: b.notes,
    created_by_id: b.createdById, created_by_name: b.createdByName,
    reserved_at: b.reservedAt, consumed_at: b.consumedAt, created_at: b.createdAt,
  };
  let { error } = await supabase.from('builds').upsert(row);
  // Tolerate the swaps column not existing yet (its migration may be unapplied).
  // Postgres reports 42703; PostgREST reports PGRST204 (column missing from its
  // schema cache) — handle both so the build still saves without swap history.
  if (error && (error.code === '42703' || error.code === 'PGRST204') && /swaps/.test(error.message)) {
    delete row.swaps;
    ({ error } = await supabase.from('builds').upsert(row));
  }
  if (error) console.error('Error syncing build:', JSON.stringify(error, null, 2));
}

export async function fetchBuilds(): Promise<Build[]> {
  const { data, error } = await supabase.from('builds').select('*').order('created_at', { ascending: false });
  if (error) { console.warn('[inventory] table not ready yet (run migration) — fetching builds:', error?.message || error); return []; }
  return data?.map((b) => ({
    id: b.id, orderId: b.order_id, status: (b.status ?? 'reserved') as BuildStatus,
    lines: (b.lines ?? []) as BuildLine[], swaps: (b.swaps ?? []) as BuildSwap[], notes: b.notes ?? undefined,
    createdById: b.created_by_id ?? undefined, createdByName: b.created_by_name ?? undefined,
    reservedAt: b.reserved_at ?? undefined, consumedAt: b.consumed_at ?? undefined,
    createdAt: b.created_at, updatedAt: b.updated_at ?? b.created_at,
  })) || [];
}

// ==================== ACCESS CONTROL ====================
// Admin-configured permissions, stored as a JSON blob in app_settings so every
// device/user shares the same config. See src/lib/access.ts.

export async function fetchAccessControl(): Promise<AccessConfig | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'access_control')
    .maybeSingle();
  if (error) {
    console.error('Error fetching access control:', { message: error.message, code: error.code });
    return null;
  }
  if (!data?.value) return null;
  try {
    return typeof data.value === 'string' ? (JSON.parse(data.value) as AccessConfig) : (data.value as AccessConfig);
  } catch {
    return null;
  }
}

export async function saveAccessControl(config: AccessConfig): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'access_control', value: JSON.stringify(config), updated_at: new Date().toISOString() });
  if (error) console.error('Error saving access control:', { message: error.message, code: error.code });
}

// ==================== APP SETTINGS ====================
// Admin-configured app configuration, stored as one JSON document in
// app_settings (same pattern as access control). Only genuine overrides are
// stored — everything else comes from the defaults in settings-schema.ts.

export async function fetchAppSettings(): Promise<SettingsValues | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_STORAGE_KEY)
    .maybeSingle();
  if (error) {
    console.error('Error fetching app settings:', { message: error.message, code: error.code });
    return null;
  }
  if (!data?.value) return null;
  try {
    return typeof data.value === 'string' ? (JSON.parse(data.value) as SettingsValues) : (data.value as SettingsValues);
  } catch {
    return null;
  }
}

export async function saveAppSettings(values: SettingsValues): Promise<void> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: SETTINGS_STORAGE_KEY, value: JSON.stringify(values), updated_at: new Date().toISOString() });
  if (error) {
    console.error('Error saving app settings:', { message: error.message, code: error.code });
    throw new Error(error.message);
  }
}

/** Append-only audit of settings changes (best-effort — never blocks a save). */
export async function recordSettingsAudit(
  entries: { key: string; from: SettingValue | null; to: SettingValue | null }[],
  user: { id?: string; name?: string },
): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await supabase.from('settings_audit').insert(
    entries.map((e) => ({
      setting_key: e.key,
      old_value: e.from === null || e.from === undefined ? null : JSON.stringify(e.from),
      new_value: e.to === null || e.to === undefined ? null : JSON.stringify(e.to),
      changed_by_id: user.id ?? null,
      changed_by_name: user.name ?? null,
      changed_at: new Date().toISOString(),
    })),
  );
  // The audit table may not exist yet (migration not applied) — don't fail the save.
  if (error) console.warn('[settings] audit not recorded:', error.message);
}

// ==================== FULL SYNC ====================

export async function loadAllFromSupabase() {
  const [users, batches, orders, returns, attendanceRecords, leaveRequests, leaveBalances, tickets, missingItems,
         inventoryParts, stockUnits, stockLevels, goodsReceipts, builds, accessControl, appSettings] = await Promise.all([
    fetchUsers(),
    fetchBatches(),
    fetchOrders(),
    fetchReturns(),
    fetchAttendance(),
    fetchLeaveRequests(),
    fetchLeaveBalances(),
    fetchTickets(),
    fetchMissingItems(),
    fetchInventoryParts(),
    fetchStockUnits(),
    fetchStockLevels(),
    fetchGoodsReceipts(),
    fetchBuilds(),
    fetchAccessControl(),
    fetchAppSettings(),
  ]);

  return {
    users,
    batches,
    orders,
    returns,
    attendanceRecords,
    leaveRequests,
    leaveBalances,
    tickets,
    missingItems,
    inventoryParts,
    stockUnits,
    stockLevels,
    goodsReceipts,
    builds,
    accessControl,
    appSettings,
  };
}
