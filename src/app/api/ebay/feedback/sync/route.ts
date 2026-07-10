import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const FEEDBACK_BASE = 'https://api.ebay.com/commerce/feedback/v1';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const FEEDBACK_SCOPE = 'https://api.ebay.com/oauth/api_scope/commerce.feedback.readonly';
const PAGE_LIMIT = 100;   // feedback entries per page
const MAX_PAGES = 30;     // backfill pages per sync → up to 3000 entries
const TIME_BUDGET_MS = 18000;   // stop paging before a serverless timeout

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

// Only auto-raise a ticket for a negative that's actually recent — otherwise the
// first full (historical) sync would flood Comms with tickets for old negatives.
function isRecentFeedback(p?: { value?: number; unit?: string }): boolean {
  const u = (p?.unit ?? '').toUpperCase();
  const v = p?.value ?? 0;
  if (['SECOND', 'MINUTE', 'HOUR'].includes(u)) return true;
  if (u === 'DAY') return v <= 14;   // eBay reports age in days, e.g. "30 DAY", "180 DAY"
  if (u === 'WEEK') return v <= 2;
  return false; // MONTH / YEAR / older / unknown → historical
}

// POST /api/ebay/feedback/sync — pull ALL received feedback, flag NEW recent negatives,
// auto-raise a ticket for each. Idempotent (dedup by feedbackId).
export async function POST() {
  const sellerId = process.env.EBAY_SELLER_USERNAME || (await getSetting('ebay_seller_username'));
  if (!sellerId) {
    return NextResponse.json({ error: 'no_seller', message: 'Set EBAY_SELLER_USERNAME (your eBay seller username) to enable feedback monitoring.' }, { status: 400 });
  }

  const token = await getAppToken();
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 401 });

  const supabase = getSupabase();
  const headers = { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', 'Content-Type': 'application/json' };
  const startedAt = Date.now();

  async function fetchPage(offset: number): Promise<{ entries: FeedbackEntry[]; total: number } | null> {
    const res = await fetch(`${FEEDBACK_BASE}/feedback?feedback_type=FEEDBACK_RECEIVED&user_id=${encodeURIComponent(sellerId!)}&limit=${PAGE_LIMIT}&offset=${offset}`, { headers });
    if (!res.ok) { console.error('[eBay feedback] page failed', offset, res.status); return null; }
    const data = JSON.parse(await res.text()) as { feedbackEntries?: FeedbackEntry[]; pagination?: { total?: number } };
    return { entries: data.feedbackEntries ?? [], total: data.pagination?.total ?? 0 };
  }

  // The API has ~27k entries; pulling them all in one request would time out.
  // So: always re-scan the newest pages (catch new feedback), then continue the
  // historical backfill from a saved offset within a time budget. Over several
  // syncs this walks back as far as eBay allows. Dedup is by feedbackId.
  const entries: FeedbackEntry[] = [];
  const first = await fetchPage(0);
  if (!first) return NextResponse.json({ error: 'ebay_api_error', message: 'feedback fetch failed' }, { status: 502 });
  const total = first.total;
  entries.push(...first.entries);
  entries.push(...((await fetchPage(PAGE_LIMIT))?.entries ?? []));

  let backfillOffset = Number((await getSetting('ebay_feedback_backfill_offset')) ?? '0');
  if (total && backfillOffset >= total) backfillOffset = 0; // wrap round to re-verify
  let pages = 0;
  while (pages < MAX_PAGES && Date.now() - startedAt < TIME_BUDGET_MS && (!total || backfillOffset < total)) {
    const page = await fetchPage(backfillOffset);
    if (!page) break;
    entries.push(...page.entries);
    backfillOffset += PAGE_LIMIT;
    pages++;
    if (page.entries.length < PAGE_LIMIT) { backfillOffset = total || backfillOffset; break; }
  }
  await supabase.from('app_settings').upsert({ key: 'ebay_feedback_backfill_offset', value: String(backfillOffset), updated_at: new Date().toISOString() });

  const ids = entries.map((e) => e.feedbackId).filter(Boolean) as string[];
  if (ids.length === 0) return NextResponse.json({ synced: 0, newNegatives: 0 });

  // Attach the listing photo from our cached listings, keyed by listing id.
  const listingIds = [...new Set(entries.map((e) => e.orderLineItemSummary?.listingId).filter(Boolean))] as string[];
  const imageByListing = new Map<string, string>();
  for (let i = 0; i < listingIds.length; i += 100) {
    const { data: imgs } = await supabase.from('ebay_listings').select('item_id,image_url').in('item_id', listingIds.slice(i, i + 100));
    for (const r of imgs ?? []) if (r.image_url) imageByListing.set(r.item_id, r.image_url);
  }

  // Which of these have we already recorded? Chunk the IN() so a few thousand
  // ids don't blow the URL length limit.
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: existing } = await supabase.from('ebay_feedback').select('feedback_id').in('feedback_id', ids.slice(i, i + 200));
    for (const r of existing ?? []) seen.add(r.feedback_id);
  }

  const rows: Record<string, unknown>[] = [];
  const newNegatives: FeedbackEntry[] = [];

  for (const e of entries) {
    if (!e.feedbackId) continue;
    const isNew = !seen.has(e.feedbackId);
    const isNegative = e.commentType === 'NEGATIVE';
    let ticketId: string | null = null;

    // Auto-raise a ticket the first time we see a *recent* negative.
    if (isNew && isNegative && isRecentFeedback(e.feedbackEnteredPeriod)) {
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
      image_url: e.orderLineItemSummary?.listingId ? imageByListing.get(e.orderLineItemSummary.listingId) ?? null : null,
      price: e.orderLineItemSummary?.listingPrice?.value,
      currency: e.orderLineItemSummary?.listingPrice?.currency,
      buyer_masked: e.providerUserDetail?.userId,
      entered_period: e.feedbackEnteredPeriod ? `${e.feedbackEnteredPeriod.value} ${e.feedbackEnteredPeriod.unit}` : null,
      // Historical (non-recent) negatives come in pre-acknowledged so the backfill
      // doesn't flood the alert banner with years-old, already-handled negatives.
      acknowledged: !(isNegative && isRecentFeedback(e.feedbackEnteredPeriod)),
      automated: e.automatedFeedback ?? false,
      state: e.feedbackState,
      ticket_id: ticketId,
    });
  }

  // Insert only new rows (don't clobber acknowledged flags on existing).
  const newRows = rows.filter((r) => !seen.has(r.feedback_id as string));
  if (newRows.length) {
    const opts = { onConflict: 'feedback_id', ignoreDuplicates: true };
    const { error } = await supabase.from('ebay_feedback').upsert(newRows, opts);
    // Tolerate the image_url column not existing yet (migration may be unapplied).
    if (error && (error.code === '42703' || error.code === 'PGRST204') && /image_url/.test(error.message)) {
      await supabase.from('ebay_feedback').upsert(newRows.map(({ image_url: _omit, ...rest }) => rest), opts);
    }
  }

  return NextResponse.json({
    synced: entries.length,
    added: newRows.length,
    newNegatives: newNegatives.length,
    // Backfill progress so the UI can show "pulling history…".
    total,
    backfillOffset,
    backfillComplete: !total || backfillOffset >= total,
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
