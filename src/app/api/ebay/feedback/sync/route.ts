import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const FEEDBACK_BASE = 'https://api.ebay.com/commerce/feedback/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const FEEDBACK_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.feedback.readonly';
const PAGE_LIMIT = 100;   // newest feedback entries to scan per sync

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}

// Feedback reads work with a client-credentials app token (commerce.feedback.readonly).
async function getAppToken(): Promise<string | null> {
  const supabase = getSupabase();
  const [{ data: at }, { data: exp }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'ebay_feedback_token').single(),
    supabase.from('app_settings').select('value').eq('key', 'ebay_feedback_token_expires_at').single(),
  ]);
  if (at?.value && Date.now() < Number(exp?.value ?? 0) - 5 * 60 * 1000) return at.value;

  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: FEEDBACK_SCOPE }),
  });
  if (!res.ok) { console.error('[eBay feedback] token failed', res.status); return null; }
  const data = await res.json() as { access_token: string; expires_in: number };
  await supabase.from('app_settings').upsert([
    { key: 'ebay_feedback_token', value: data.access_token, updated_at: new Date().toISOString() },
    { key: 'ebay_feedback_token_expires_at', value: String(Date.now() + data.expires_in * 1000), updated_at: new Date().toISOString() },
  ]);
  return data.access_token;
}

interface FeedbackEntry {
  feedbackId?: string;
  commentType?: string;
  feedbackComment?: { commentText?: string; state?: string };
  orderLineItemSummary?: { listingId?: string; listingTitle?: string; listingPrice?: { value?: number; currency?: string } };
  feedbackEnteredPeriod?: { value?: number; unit?: string };
  providerUserDetail?: { userId?: string };
  automatedFeedback?: boolean;
  feedbackState?: string;
}

// POST /api/ebay/feedback/sync — pull recent received feedback, flag NEW negatives,
// auto-raise a ticket for each. Idempotent (dedup by feedbackId).
export async function POST() {
  const sellerId = process.env.EBAY_SELLER_USERNAME || (await getSetting('ebay_seller_username'));
  if (!sellerId) {
    return NextResponse.json({ error: 'no_seller', message: 'Set EBAY_SELLER_USERNAME (your eBay seller username) to enable feedback monitoring.' }, { status: 400 });
  }

  const token = await getAppToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();
  const url = `${FEEDBACK_BASE}/feedback?feedback_type=FEEDBACK_RECEIVED&user_id=${encodeURIComponent(sellerId)}&limit=${PAGE_LIMIT}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' } });
  const body = await res.text();
  if (!res.ok) {
    console.error('[eBay feedback] fetch failed', res.status, body.slice(0, 300));
    return NextResponse.json({ error: 'ebay_api_error', status: res.status, message: body.slice(0, 300) }, { status: 502 });
  }

  const entries = (JSON.parse(body) as { feedbackEntries?: FeedbackEntry[] }).feedbackEntries ?? [];
  const ids = entries.map((e) => e.feedbackId).filter(Boolean) as string[];
  if (ids.length === 0) return NextResponse.json({ synced: 0, newNegatives: 0 });

  // Which of these have we already recorded?
  const { data: existing } = await supabase.from('ebay_feedback').select('feedback_id').in('feedback_id', ids);
  const seen = new Set((existing ?? []).map((r) => r.feedback_id));

  const rows: Record<string, unknown>[] = [];
  const newNegatives: FeedbackEntry[] = [];

  for (const e of entries) {
    if (!e.feedbackId) continue;
    const isNew = !seen.has(e.feedbackId);
    const isNegative = e.commentType === 'NEGATIVE';
    let ticketId: string | null = null;

    // Auto-raise a ticket the first time we see a negative.
    if (isNew && isNegative) {
      newNegatives.push(e);
      ticketId = randomUUID();
      const now = new Date().toISOString();
      const title = e.orderLineItemSummary?.listingTitle ?? 'listing';
      await supabase.from('tickets').insert({
        id: ticketId,
        subject: `⚠️ Negative feedback: ${title.slice(0, 80)}`,
        body: e.feedbackComment?.commentText ?? '',
        category: 'other',
        status: 'open',
        priority: 'urgent',
        department: 'comms',
        contact_method: 'ebay_message',
        item_title: title,
        order_number: e.orderLineItemSummary?.listingId,
        created_by_name: 'System (feedback monitor)',
        activity: [{ at: now, byName: 'System', type: 'create', text: `Negative feedback received: "${e.feedbackComment?.commentText ?? ''}"` }],
        created_at: now,
      });
    }

    rows.push({
      feedback_id: e.feedbackId,
      comment_type: e.commentType,
      comment_text: e.feedbackComment?.commentText,
      listing_id: e.orderLineItemSummary?.listingId,
      listing_title: e.orderLineItemSummary?.listingTitle,
      price: e.orderLineItemSummary?.listingPrice?.value,
      currency: e.orderLineItemSummary?.listingPrice?.currency,
      buyer_masked: e.providerUserDetail?.userId,
      entered_period: e.feedbackEnteredPeriod ? `${e.feedbackEnteredPeriod.value} ${e.feedbackEnteredPeriod.unit}` : null,
      automated: e.automatedFeedback ?? false,
      state: e.feedbackState,
      ticket_id: ticketId,
    });
  }

  // Insert only new rows (don't clobber acknowledged flags on existing).
  const newRows = rows.filter((r) => !seen.has(r.feedback_id as string));
  if (newRows.length) await supabase.from('ebay_feedback').upsert(newRows, { onConflict: 'feedback_id', ignoreDuplicates: true });

  return NextResponse.json({
    synced: entries.length,
    newNegatives: newNegatives.length,
    negatives: newNegatives.map((e) => ({ text: e.feedbackComment?.commentText, listing: e.orderLineItemSummary?.listingTitle })),
  });
}

// GET — current unacknowledged negative feedback (for the alert banner).
export async function GET() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('ebay_feedback')
    .select('*')
    .eq('comment_type', 'NEGATIVE')
    .eq('acknowledged', false)
    .order('first_seen_at', { ascending: false })
    .limit(20);
  return NextResponse.json({ negatives: data ?? [] });
}

// PATCH — acknowledge (dismiss) negative feedback alerts by feedback_id.
export async function PATCH(req: Request) {
  const { feedbackIds } = await req.json() as { feedbackIds: string[] };
  if (!feedbackIds?.length) return NextResponse.json({ error: 'feedbackIds required' }, { status: 400 });
  await getSupabase().from('ebay_feedback').update({ acknowledged: true }).in('feedback_id', feedbackIds);
  return NextResponse.json({ success: true });
}
