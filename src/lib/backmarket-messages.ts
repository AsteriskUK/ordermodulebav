import { getBackmarketBaseUrl, getBackmarketHeaders } from './backmarket-api';

// BackMarket customer messaging is the "SAV" (service après-vente / after-sales)
// API. A SAV thread = a Care Folder; each thread carries a `messages[]` array and
// links to an order via orderline.order.order_id.
//   GET  /ws/sav              → paginated thread list
//   GET  /ws/sav/{id}         → full thread incl. messages
//   POST /ws/sav/{id}/messages → post a merchant reply

export interface BackmarketMessageAttachment {
  id?: number;
  attachment?: string;        // URL
  date_creation?: string;
}

export interface BackmarketMessage {
  id: number;
  message: string;            // HTML
  date_creation?: string;
  attachments?: BackmarketMessageAttachment[];
  initiator?: string;         // "Merchant" = us, "BackMarket"/"Customer" = inbound
  kind?: string;              // e.g. MERCHANT_TO_BACKCARE, BACKCARE_TO_MERCHANT
  is_informative?: boolean;   // informative messages don't trigger LRR
}

interface BackmarketSavParty { id?: number; username?: string; first_name?: string; last_name?: string; email?: string }

export interface BackmarketSavDetail {
  id: number;
  state?: number;
  backcare?: boolean;
  country_code?: string;
  client?: BackmarketSavParty;
  merchant?: BackmarketSavParty;
  orderline?: { id?: number; order?: { order_id?: number } };
  lines?: { issues?: { customerIssue?: string; tag?: string }[] }[];
  messages?: BackmarketMessage[];
  date_creation?: string;
  date_modification?: string;
  date_last_message?: string | null;
  date_closed?: string | null;
}

export interface BackmarketSavSummary {
  id: number;
  orderline?: number;
  state?: number;
  date_creation?: string;
  date_modification?: string;
  date_last_message?: string | null;
  date_closed?: string | null;
}

export interface BackmarketMessageRow {
  bm_message_id: string;
  group_id?: string;          // SAV thread id
  order_id?: string;
  direction: 'sent' | 'received';
  customer_name?: string;
  subject?: string;
  message_text: string;
  media_urls: string[];
  kind?: string;
  is_informative: boolean;
  sent_at: string;
  status: string;             // sent | failed | unread | read
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

export async function fetchBackmarketSavList(page = 1): Promise<{ count: number; next: string | null; results: BackmarketSavSummary[] }> {
  const res = await fetch(`${getBackmarketBaseUrl()}/ws/sav?page=${page}`, { headers: getBackmarketHeaders() });
  if (!res.ok) throw new Error(`BackMarket /ws/sav ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function fetchBackmarketSavDetail(id: number | string): Promise<BackmarketSavDetail> {
  const res = await fetch(`${getBackmarketBaseUrl()}/ws/sav/${id}`, { headers: getBackmarketHeaders() });
  if (!res.ok) throw new Error(`BackMarket /ws/sav/${id} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function postBackmarketReply(id: number | string, message: string, isInformative = false): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${getBackmarketBaseUrl()}/ws/sav/${id}/messages`, {
    method: 'POST',
    headers: getBackmarketHeaders(),
    body: JSON.stringify({ message, is_informative: isInformative }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

/** Merchant-initiated messages are our outbound; everything else is inbound. */
export function messageDirection(m: BackmarketMessage): 'sent' | 'received' {
  if ((m.initiator ?? '').toLowerCase() === 'merchant') return 'sent';
  if ((m.kind ?? '').toUpperCase().startsWith('MERCHANT')) return 'sent';
  return 'received';
}

// BackMarket message bodies are HTML; flatten to readable text for the inbox.
function htmlToText(html: string): string {
  return (html || '')
    .replace(/<\/(p|div|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface BackmarketThreadContext {
  groupId: string;
  orderId?: string;
  customerName?: string;
  subject?: string;
}

export function savContext(detail: BackmarketSavDetail): BackmarketThreadContext {
  const orderId = detail.orderline?.order?.order_id;
  const name = [detail.client?.first_name, detail.client?.last_name].filter(Boolean).join(' ').trim();
  const issue = detail.lines?.[0]?.issues?.[0];
  const subject = issue ? [issue.tag, issue.customerIssue].filter(Boolean).join(' · ') : undefined;
  return {
    groupId: String(detail.id),
    orderId: orderId != null ? String(orderId) : undefined,
    customerName: name || detail.client?.username || undefined,
    subject,
  };
}

export function mapBackmarketMessage(m: BackmarketMessage, ctx: BackmarketThreadContext): BackmarketMessageRow | null {
  if (m.id == null) return null;
  const direction = messageDirection(m);
  return {
    bm_message_id: String(m.id),
    group_id: ctx.groupId,
    order_id: ctx.orderId,
    direction,
    customer_name: ctx.customerName,
    subject: ctx.subject,
    message_text: htmlToText(m.message ?? ''),
    media_urls: (m.attachments ?? [])
      .map((a) => a.attachment)
      .filter((u): u is string => !!u && /^https?:\/\//i.test(u)),
    kind: m.kind,
    is_informative: !!m.is_informative,
    sent_at: m.date_creation ?? new Date().toISOString(),
    status: direction === 'received' ? 'unread' : 'sent',
  };
}
