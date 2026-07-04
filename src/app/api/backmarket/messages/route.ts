import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isBackmarketConfigured } from '@/lib/backmarket-api';
import {
  fetchBackmarketSavList,
  fetchBackmarketSavDetail,
  postBackmarketReply,
  savContext,
  mapBackmarketMessage,
  BackmarketMessageRow,
} from '@/lib/backmarket-messages';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

const TIME_BUDGET_MS = 9000;
const MAX_PAGES = 12;
const MAX_DETAILS = 120;

// GET /api/backmarket/messages           → cached messages from Supabase
// GET /api/backmarket/messages?savId=ID  → refetch that thread from BackMarket, upsert, return it
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const savId = new URL(req.url).searchParams.get('savId');

  if (savId) {
    if (isBackmarketConfigured()) {
      try {
        const detail = await fetchBackmarketSavDetail(savId);
        const ctx = savContext(detail);
        const rows = (detail.messages ?? [])
          .map((m) => mapBackmarketMessage(m, ctx))
          .filter((r): r is BackmarketMessageRow => r !== null);
        if (rows.length) await supabase.from('backmarket_messages').upsert(rows, { onConflict: 'bm_message_id' });
      } catch (e) {
        console.warn('[BM messages] thread refetch failed', e);
      }
    }
    const { data } = await supabase.from('backmarket_messages').select('*').eq('group_id', savId).order('sent_at', { ascending: true });
    return NextResponse.json({ messages: data ?? [] });
  }

  const { data } = await supabase.from('backmarket_messages').select('*').order('sent_at', { ascending: false }).limit(1000);
  return NextResponse.json({ messages: data ?? [] });
}

// POST /api/backmarket/messages                       → incremental sync of threads/messages
// POST /api/backmarket/messages  { savId, message }   → post a merchant reply
export async function POST(req: NextRequest) {
  if (!isBackmarketConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 401 });
  const supabase = getSupabase();

  const body = await req.json().catch(() => ({})) as { savId?: string | number; message?: string; isInformative?: boolean };

  // ---- Reply ----
  if (body.savId && body.message) {
    const res = await postBackmarketReply(body.savId, body.message, body.isInformative);
    if (!res.ok) return NextResponse.json({ error: 'reply_failed', status: res.status, message: res.body.slice(0, 300) }, { status: 502 });
    // Refetch the thread so the new message is stored with correct direction/ids.
    try {
      const detail = await fetchBackmarketSavDetail(body.savId);
      const ctx = savContext(detail);
      const rows = (detail.messages ?? []).map((m) => mapBackmarketMessage(m, ctx)).filter((r): r is BackmarketMessageRow => r !== null);
      if (rows.length) await supabase.from('backmarket_messages').upsert(rows, { onConflict: 'bm_message_id' });
    } catch { /* the reply still succeeded */ }
    return NextResponse.json({ success: true });
  }

  // ---- Sync ----
  const startedAt = Date.now();
  const full = new URL(req.url).searchParams.get('full') === '1';
  const { data: wmRow } = await supabase.from('app_settings').select('value').eq('key', 'backmarket_messages_last_sync').single();
  const watermark = full ? 0 : (wmRow?.value ? new Date(wmRow.value).getTime() : 0);

  let synced = 0;
  let details = 0;
  let lastError: string | null = null;
  let hadError = false;
  let newestSeen = watermark;
  let reachedKnown = false;

  for (let page = 1; page <= MAX_PAGES && !reachedKnown; page++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS || details >= MAX_DETAILS) break;
    let list;
    try {
      list = await fetchBackmarketSavList(page);
    } catch (e) {
      console.error('[BM messages] list failed', e);
      hadError = true;
      break;
    }
    const threads = list.results ?? [];
    if (threads.length === 0) break;

    for (const t of threads) {
      // Only threads that have at least one message are worth fetching.
      const modified = t.date_last_message || t.date_modification;
      const modMs = modified ? new Date(modified).getTime() : 0;
      if (!t.date_last_message) continue;
      if (modMs && modMs <= watermark) { reachedKnown = true; break; }
      if (modMs > newestSeen) newestSeen = modMs;

      if (details >= MAX_DETAILS || Date.now() - startedAt > TIME_BUDGET_MS) { reachedKnown = true; break; }
      try {
        const detail = await fetchBackmarketSavDetail(t.id);
        details++;
        const ctx = savContext(detail);
        const rows = (detail.messages ?? []).map((m) => mapBackmarketMessage(m, ctx)).filter((r): r is BackmarketMessageRow => r !== null);
        if (rows.length) {
          const { error } = await supabase.from('backmarket_messages').upsert(rows, { onConflict: 'bm_message_id', ignoreDuplicates: true });
          if (!error) synced += rows.length; else { lastError = error.message; hadError = true; }
        }
      } catch (e) {
        console.warn('[BM messages] detail failed', t.id, e);
        hadError = true;
      }
    }
    if (!list.next) break;
  }

  // Only advance the watermark on a clean run, so a failed sync (RLS, transient
  // errors) re-attempts next time instead of silently skipping messages.
  if (newestSeen > watermark && !hadError) {
    await supabase.from('app_settings').upsert({ key: 'backmarket_messages_last_sync', value: new Date(newestSeen).toISOString(), updated_at: new Date().toISOString() });
  }

  return NextResponse.json({ synced, threadsFetched: details, lastError });
}

// PATCH /api/backmarket/messages — mark received messages in a thread as read
export async function PATCH(req: Request) {
  const { ids, read = true } = await req.json() as { ids: string[]; read?: boolean };
  const supabase = getSupabase();
  await supabase.from('backmarket_messages').update({ status: read ? 'read' : 'unread' }).in('id', ids).eq('direction', 'received');
  return NextResponse.json({ success: true });
}
