import { supabase } from './supabase-client';
import { Order, Batch, AppUser, AttendanceRecord, LeaveRequest, LeaveBalance, EodEvent, ReturnRecord } from './types';

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
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_notes(*)');
  
  if (error) {
    console.error('Error fetching orders:', error);
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
    importedAt: o.imported_at,
    returnId: o.return_id,
    labelPrintedAt: o.label_printed_at,
    labelCarrier: o.label_carrier,
    labelData: o.label_data,
    isReplacement: o.metadata?.is_replacement,
    originalOrderId: o.metadata?.original_order_id,
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
      metadata: {
        is_replacement: order.isReplacement,
        original_order_id: order.originalOrderId,
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

    const { error: notesError } = await supabase
      .from('order_notes')
      .insert(order.notes.map((n) => ({
        id: isValidUUID(n.id) ? n.id : undefined,
        order_id: order.id,
        author_id: n.authorId && isValidUUID(n.authorId) ? n.authorId : undefined,
        author_name: n.authorName,
        text: n.text,
        created_at: n.createdAt,
      })));
    if (notesError) {
      console.error('Error syncing order notes:', JSON.stringify(notesError, null, 2));
    }
  }
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
      received_notes: ret.receivedNotes,
      image_urls: ret.imageUrls,
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
    receivedNotes: r.metadata?.received_notes,
    imageUrls: r.metadata?.image_urls,
    responsibleDepartment: r.responsible_department,
    responsibleUserId: r.responsible_user_id,
    responsibleUserName: r.responsible_user_name,
  })) || [];
}

// ==================== FULL SYNC ====================

export async function loadAllFromSupabase() {
  const [users, batches, orders, returns, attendanceRecords, leaveRequests, leaveBalances] = await Promise.all([
    fetchUsers(),
    fetchBatches(),
    fetchOrders(),
    fetchReturns(),
    fetchAttendance(),
    fetchLeaveRequests(),
    fetchLeaveBalances(),
  ]);
  
  return {
    users,
    batches,
    orders,
    returns,
    attendanceRecords,
    leaveRequests,
    leaveBalances,
  };
}
