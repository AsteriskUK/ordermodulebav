import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isAmazonConfigured,
  getAmazonMessagingActions,
  sendAmazonMessage,
  AMAZON_TEXT_ACTIONS,
} from '@/lib/amazon-client';
import { isAmazonMailConfigured, fetchAmazonMailbox, sendAmazonEmailReply } from '@/lib/amazon-mail';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Actions this app can send: free-text types plus the body-less feedback-removal
// request. Attachment-only types (legalDisclosure, sendInvoice, sendAmazonMotors,
// warranty) are excluded — we have no attachment upload flow for Amazon.
const SENDABLE_ACTIONS = new Set([...AMAZON_TEXT_ACTIONS, 'negativeFeedbackRemoval']);

// GET /api/amazon/messages                     → all stored messages (inbox pane)
// GET /api/amazon/messages?orderId=X           → stored messages for that order
// GET /api/amazon/messages?orderId=X&actions=1 → message types Amazon allows right now
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const orderId = params.get('orderId');

  if (params.get('actions')) {
    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    if (!isAmazonConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 401 });
    try {
      const allowed = await getAmazonMessagingActions(orderId);
      return NextResponse.json({ actions: allowed.filter((a) => SENDABLE_ACTIONS.has(a)) });
    } catch (e) {
      return NextResponse.json({ error: 'actions_failed', message: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  let query = getSupabase().from('amazon_messages').select('*');
  query = orderId
    ? query.eq('amazon_order_id', orderId).order('sent_at', { ascending: true })
    : query.order('sent_at', { ascending: false }).limit(1000);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

// POST /api/amazon/messages
//   {}                                    → sync inbound buyer emails (relay bridge)
//   { replyToEmail, subject?, text, … }   → free-text email reply into the buyer's thread
//   { orderId, action, text?, … }         → templated SP-API message
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    orderId?: string;        // Amazon order id (3-7-7)
    action?: string;         // SP-API message type
    replyToEmail?: string;   // anonymised relay address (email reply path)
    subject?: string;
    text?: string;
    buyerName?: string;
    itemTitle?: string;
    sentById?: string;
    sentByName?: string;
  };
  const { orderId, action, replyToEmail, subject, text, buyerName, itemTitle, sentById, sentByName } = body;

  const supabase = getSupabase();

  // ---- Email reply into the buyer's Amazon thread ----
  if (replyToEmail) {
    if (!isAmazonMailConfigured()) return NextResponse.json({ error: 'mail_not_configured' }, { status: 401 });
    if (!text?.trim()) return NextResponse.json({ error: 'Message text required' }, { status: 400 });

    const row = {
      amazon_order_id: orderId ?? '',
      action: null,
      subject: subject ?? null,
      reply_to_email: replyToEmail,
      message_text: text.trim(),
      buyer_name: buyerName,
      item_title: itemTitle,
      sent_by_id: sentById,
      sent_by_name: sentByName,
      direction: 'sent',
      sent_at: new Date().toISOString(),
    };
    try {
      await sendAmazonEmailReply(replyToEmail, subject || `Re: your Amazon order ${orderId ?? ''}`.trim(), text.trim());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[Amazon messages] email reply error:', message);
      await supabase.from('amazon_messages').insert({ ...row, status: 'failed' });
      return NextResponse.json({ error: 'send_failed', message }, { status: 502 });
    }
    await supabase.from('amazon_messages').insert({ ...row, status: 'sent' });
    return NextResponse.json({ success: true });
  }

  // ---- Templated SP-API send ----
  if (orderId && action) {
    if (!isAmazonConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 401 });
    if (!SENDABLE_ACTIONS.has(action)) {
      return NextResponse.json({ error: `Unsupported action "${action}" — only text-based message types can be sent from here` }, { status: 400 });
    }
    if (AMAZON_TEXT_ACTIONS.has(action) && !text?.trim()) {
      return NextResponse.json({ error: 'Message text required for this action' }, { status: 400 });
    }

    const row = {
      amazon_order_id: orderId,
      action,
      message_text: text ?? '',
      buyer_name: buyerName,
      item_title: itemTitle,
      sent_by_id: sentById,
      sent_by_name: sentByName,
      direction: 'sent',
      sent_at: new Date().toISOString(),
    };
    try {
      await sendAmazonMessage(orderId, action, text?.trim());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[Amazon messages] send error:', message);
      await supabase.from('amazon_messages').insert({ ...row, status: 'failed' });
      return NextResponse.json({ error: 'send_failed', message }, { status: 502 });
    }
    await supabase.from('amazon_messages').insert({ ...row, status: 'sent' });
    return NextResponse.json({ success: true });
  }

  // ---- Mailbox sync (no body) ----
  if (!isAmazonMailConfigured()) return NextResponse.json({ error: 'mail_not_configured' }, { status: 401 });

  const { data: wmRow } = await supabase.from('app_settings').select('value').eq('key', 'amazon_mail_last_sync').single();
  const watermark = wmRow?.value ? new Date(wmRow.value).getTime() : 0;

  let inbound;
  try {
    inbound = await fetchAmazonMailbox(watermark);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[Amazon messages] mailbox sync error:', message);
    return NextResponse.json({ error: 'sync_failed', message }, { status: 502 });
  }

  let synced = 0;
  let newest = watermark;
  let hadError = false;
  if (inbound.length > 0) {
    const rows = inbound.map((m) => ({
      email_message_id: m.emailMessageId,
      amazon_order_id: m.amazonOrderId ?? '',
      action: null,
      subject: m.subject,
      reply_to_email: m.replyToEmail,
      message_text: m.text,
      buyer_name: m.buyerName,
      direction: 'received',
      status: 'unread',
      sent_at: m.sentAt,
    }));
    const { error } = await supabase.from('amazon_messages').upsert(rows, { onConflict: 'email_message_id', ignoreDuplicates: true });
    if (error) {
      console.error('[Amazon messages] upsert error:', error.message);
      hadError = true;
    } else {
      synced = rows.length;
    }
    newest = Math.max(newest, ...inbound.map((m) => new Date(m.sentAt).getTime()));
  }

  // Only advance the watermark on a clean run so a failed sync re-attempts.
  if (newest > watermark && !hadError) {
    await supabase.from('app_settings').upsert({ key: 'amazon_mail_last_sync', value: new Date(newest).toISOString(), updated_at: new Date().toISOString() });
  }

  return NextResponse.json({ synced });
}

// PATCH /api/amazon/messages — mark received messages as read/unread
export async function PATCH(req: Request) {
  const { ids, read = true, action } = await req.json() as {
    ids: string[];
    read?: boolean;
    action?: 'archive' | 'unarchive' | 'delete';   // app-side archive / soft-delete
  };
  const supabase = getSupabase();
  if (action) {
    if (action === 'archive' || action === 'delete') {
      await supabase.from('amazon_messages').update({ status: action === 'archive' ? 'archived' : 'deleted' }).in('id', ids);
    } else {
      await supabase.from('amazon_messages').update({ status: 'read' }).in('id', ids).eq('direction', 'received');
      await supabase.from('amazon_messages').update({ status: 'sent' }).in('id', ids).eq('direction', 'sent');
    }
    return NextResponse.json({ success: true });
  }
  await supabase.from('amazon_messages').update({ status: read ? 'read' : 'unread' }).in('id', ids).eq('direction', 'received');
  return NextResponse.json({ success: true });
}
