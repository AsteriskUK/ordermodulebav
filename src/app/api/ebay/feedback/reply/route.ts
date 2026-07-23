import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-admin';
import { getEbayUserToken } from '@/lib/ebay-client';

// eBay's Commerce Feedback REST API is read-only, so a *public reply* to feedback
// a buyer left us goes through the legacy Trading API RespondToFeedback call
// (ResponseType=Reply). It needs the seller's user OAuth token (IAF scheme).
const TRADING_API_URL = 'https://api.ebay.com/ws/api.dll';
const MAX_LEN = 500; // eBay caps a feedback response at 500 characters.

function getXmlValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// POST /api/ebay/feedback/reply — publicly reply to a piece of received feedback.
export async function POST(req: Request) {
  const { feedbackId, responseText } = await req.json() as { feedbackId?: string; responseText?: string };
  if (!feedbackId) return NextResponse.json({ error: 'feedbackId required' }, { status: 400 });
  const text = (responseText ?? '').trim();
  if (!text) return NextResponse.json({ error: 'responseText required' }, { status: 400 });
  if (text.length > MAX_LEN) return NextResponse.json({ error: 'too_long', message: `Reply must be ${MAX_LEN} characters or fewer.` }, { status: 400 });

  const token = await getEbayUserToken();
  if (!token) return NextResponse.json({ error: 'not_connected', message: 'Reconnect your eBay account to reply to feedback.' }, { status: 401 });

  const body = `<?xml version="1.0" encoding="utf-8"?>
<RespondToFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <FeedbackID>${escapeXml(feedbackId)}</FeedbackID>
  <ResponseType>Reply</ResponseType>
  <ResponseText>${escapeXml(text)}</ResponseText>
</RespondToFeedbackRequest>`;

  const res = await fetch(TRADING_API_URL, {
    method: 'POST',
    headers: {
      'X-EBAY-API-CALL-NAME': 'RespondToFeedback',
      'X-EBAY-API-SITEID': '3',                 // 3 = eBay UK
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1207',
      'X-EBAY-API-IAF-TOKEN': token,
      'Content-Type': 'text/xml',
    },
    body,
  });

  const xml = await res.text();
  const ack = getXmlValue(xml, 'Ack');
  if (!res.ok || ack === 'Failure') {
    const err = getXmlValue(xml, 'LongMessage') || getXmlValue(xml, 'ShortMessage') || xml.slice(0, 400);
    console.error('[eBay feedback reply] RespondToFeedback failed', res.status, err);
    return NextResponse.json({ error: 'ebay_api_error', message: err }, { status: 502 });
  }

  // Persist the reply so it shows on the card. Tolerate the columns not existing
  // yet (their migration may be unapplied) — the reply is already live on eBay.
  const repliedAt = new Date().toISOString();
  const supabase = getServiceClient();
  const { error } = await supabase.from('ebay_feedback').update({ reply_text: text, replied_at: repliedAt }).eq('feedback_id', feedbackId);
  if (error && !(error.code === '42703' || error.code === 'PGRST204')) {
    console.error('[eBay feedback reply] persist failed', error.message);
  }

  return NextResponse.json({ success: true, feedbackId, repliedAt });
}
