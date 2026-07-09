import { ImapFlow } from 'imapflow';
import { simpleParser, AddressObject } from 'mailparser';
import nodemailer from 'nodemailer';

// Amazon buyer-message email bridge.
//
// SP-API has no API to *read* buyer messages — Amazon only exposes them via the
// Buyer-Seller Messaging relay: each buyer message is forwarded to the seller's
// notification email from an anonymised @marketplace.amazon.* address, and an
// email reply to that address is delivered back into the buyer's Amazon thread
// (free text, unlike the templated SP-API send). So a proper two-way inbox =
// IMAP-ingest that mailbox + SMTP-reply to the relay address.
//
// Env:
//   AMAZON_MAIL_USER, AMAZON_MAIL_PASS   (Gmail: use an app password)
//   AMAZON_MAIL_IMAP_HOST (default imap.gmail.com)
//   AMAZON_MAIL_SMTP_HOST (default smtp.gmail.com)
//   AMAZON_MAIL_FROM      (default AMAZON_MAIL_USER — must be the notification
//                          email registered in Seller Central or Amazon drops it)

export interface AmazonMailConfig {
  user: string;
  pass: string;
  imapHost: string;
  smtpHost: string;
  from: string;
}

export function getAmazonMailConfig(): AmazonMailConfig | null {
  const user = process.env.AMAZON_MAIL_USER;
  const pass = process.env.AMAZON_MAIL_PASS;
  if (!user || !pass) return null;
  return {
    user,
    pass,
    imapHost: process.env.AMAZON_MAIL_IMAP_HOST || 'imap.gmail.com',
    smtpHost: process.env.AMAZON_MAIL_SMTP_HOST || 'smtp.gmail.com',
    from: process.env.AMAZON_MAIL_FROM || user,
  };
}

export function isAmazonMailConfigured(): boolean {
  return !!getAmazonMailConfig();
}

export interface InboundAmazonMessage {
  emailMessageId: string;      // RFC Message-ID header (dedup key)
  amazonOrderId: string | null;
  buyerName: string | null;
  subject: string | null;
  replyToEmail: string | null; // the anonymised relay address to reply to
  text: string;
  sentAt: string;
}

const RELAY_RE = /@marketplace\.amazon\./i;
const ORDER_ID_RE = /\b(\d{3}-\d{7}-\d{7})\b/;
const BEGIN_MARKER = /-{2,}\s*Begin message\s*-{2,}/i;
const END_MARKER = /-{2,}\s*End message\s*-{2,}/i;

// Amazon wraps the buyer's words in Begin/End markers with boilerplate around
// them; older/plainer notifications have no markers, so fall back to trimming
// the obvious footer lines.
function extractBuyerText(raw: string): string {
  const begin = raw.search(BEGIN_MARKER);
  const end = raw.search(END_MARKER);
  if (begin !== -1 && end > begin) {
    const afterMarker = raw.slice(begin).replace(BEGIN_MARKER, '');
    return afterMarker.slice(0, afterMarker.search(END_MARKER)).trim();
  }
  return raw
    .split(/\r?\n/)
    .filter((l) => !/^(To respond to this customer|We hope|Thank you for selling with Amazon|Sincerely|Amazon Services)/i.test(l.trim()))
    .join('\n')
    .trim();
}

function firstAddress(a?: AddressObject | AddressObject[]): { address?: string; name?: string } {
  const obj = Array.isArray(a) ? a[0] : a;
  return obj?.value?.[0] ?? {};
}

// Buyer name from the From display-name, e.g. "John Smith - Amazon Marketplace".
function extractBuyerName(fromName?: string, subject?: string): string | null {
  const cleaned = (fromName ?? '').replace(/\s*-?\s*Amazon Marketplace\s*$/i, '').trim();
  if (cleaned && !/^amazon/i.test(cleaned)) return cleaned;
  const m = subject?.match(/from Amazon customer\s+(.+?)(?:\s*\(|$)/i);
  return m?.[1]?.trim() ?? null;
}

/** Pull buyer-seller relay emails newer than `sinceMs` from the INBOX. */
export async function fetchAmazonMailbox(sinceMs: number, budgetMs = 15000): Promise<InboundAmazonMessage[]> {
  const cfg = getAmazonMailConfig();
  if (!cfg) throw new Error('Amazon mailbox not configured');

  const client = new ImapFlow({
    host: cfg.imapHost,
    port: 993,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const out: InboundAmazonMessage[] = [];
  const startedAt = Date.now();
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Re-scan a 1-day overlap so boundary messages aren't missed (dedup by
      // Message-ID); never look back more than 30 days on a cold start.
      const since = new Date(Math.max(sinceMs - 24 * 3600 * 1000, Date.now() - 30 * 24 * 3600 * 1000));
      const uids = await client.search({ since }, { uid: true });

      for (const uid of uids || []) {
        if (Date.now() - startedAt > budgetMs) break;
        const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;

        const envFrom = msg.envelope?.from?.[0]?.address ?? '';
        const envReplyTo = msg.envelope?.replyTo?.[0]?.address ?? '';
        if (!RELAY_RE.test(envFrom) && !RELAY_RE.test(envReplyTo)) continue;

        const parsed = await simpleParser(msg.source);
        const text = extractBuyerText(parsed.text ?? '');
        if (!text) continue;

        const from = firstAddress(parsed.from);
        const replyTo = firstAddress(parsed.replyTo);
        const subject = parsed.subject ?? msg.envelope?.subject ?? null;
        const replyToEmail = [replyTo.address, from.address].find((a) => a && RELAY_RE.test(a)) ?? null;

        out.push({
          emailMessageId: parsed.messageId ?? `imap-uid-${cfg.user}-${uid}`,
          amazonOrderId: subject?.match(ORDER_ID_RE)?.[1] ?? text.match(ORDER_ID_RE)?.[1] ?? null,
          buyerName: extractBuyerName(from.name, subject ?? undefined),
          subject,
          replyToEmail,
          text,
          sentAt: (parsed.date ?? new Date()).toISOString(),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Reply into the buyer's Amazon thread via the anonymised relay address. */
export async function sendAmazonEmailReply(to: string, subject: string, text: string): Promise<void> {
  const cfg = getAmazonMailConfig();
  if (!cfg) throw new Error('Amazon mailbox not configured');
  if (!RELAY_RE.test(to)) throw new Error(`Refusing to send: ${to} is not an Amazon relay address`);

  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transport.sendMail({ from: cfg.from, to, subject, text });
}
