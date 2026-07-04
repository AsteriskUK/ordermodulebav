import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// eBay "Digital Signatures for APIs": signature-required endpoints (Finances, and
// other money/PII APIs) reject requests without an RFC 9421 HTTP Message
// Signature. We mint a signing key once via the Key Management API, cache it in
// Supabase app_settings, and sign each request with it.
//
// Docs: developer.ebay.com → "Digital Signatures for APIs".

const KEY_MGMT_URL = 'https://apiz.ebay.com/developer/key_management/v1/signing_key';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const APP_SCOPE = 'https://api.ebay.com/oauth/api_scope';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
type SB = ReturnType<typeof getSupabase>;

async function getSetting(sb: SB, key: string): Promise<string | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}
async function setSetting(sb: SB, key: string, value: string): Promise<void> {
  await sb.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

// Application (client-credentials) token — required to call Key Management.
async function getAppToken(): Promise<string> {
  const creds = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: APP_SCOPE }),
  });
  if (!res.ok) throw new Error(`eBay app token failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json() as { access_token: string }).access_token;
}

export interface SigningKey {
  jwe: string;          // value for the x-ebay-signature-key header
  privateKey: string;   // base64 PKCS#8 (or PEM) private key
  cipher: string;       // ED25519 | RSA
  keyId?: string;
  expiry: number;       // epoch ms
}

// eBay returns expirationTime as epoch seconds; be lenient about seconds/ms/ISO.
function parseExpiry(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const t = new Date(v).getTime();
    if (!isNaN(t)) return t;
  }
  return Date.now() + 365 * 24 * 3600 * 1000;
}

async function createSigningKey(sb: SB): Promise<SigningKey> {
  const token = await getAppToken();
  const res = await fetch(KEY_MGMT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signingKeyCipher: 'ED25519' }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay createSigningKey failed ${res.status}: ${text.slice(0, 400)}`);
  const d = JSON.parse(text) as {
    jwe: string; privateKey: string; signingKeyCipher?: string; signingKeyId?: string; expirationTime?: string | number;
  };
  const key: SigningKey = {
    jwe: d.jwe,
    privateKey: d.privateKey,
    cipher: d.signingKeyCipher || 'ED25519',
    keyId: d.signingKeyId,
    expiry: parseExpiry(d.expirationTime),
  };
  await Promise.all([
    setSetting(sb, 'ebay_signing_key_jwe', key.jwe),
    setSetting(sb, 'ebay_signing_key_private', key.privateKey),
    setSetting(sb, 'ebay_signing_key_cipher', key.cipher),
    setSetting(sb, 'ebay_signing_key_id', key.keyId ?? ''),
    setSetting(sb, 'ebay_signing_key_expiry', String(key.expiry)),
  ]);
  return key;
}

let _cached: SigningKey | null = null;

export async function getSigningKey(forceCreate = false): Promise<SigningKey> {
  if (!forceCreate && _cached && Date.now() < _cached.expiry - 60_000) return _cached;
  const sb = getSupabase();
  if (!forceCreate) {
    const [jwe, privateKey, cipher, keyId, expiry] = await Promise.all([
      getSetting(sb, 'ebay_signing_key_jwe'),
      getSetting(sb, 'ebay_signing_key_private'),
      getSetting(sb, 'ebay_signing_key_cipher'),
      getSetting(sb, 'ebay_signing_key_id'),
      getSetting(sb, 'ebay_signing_key_expiry'),
    ]);
    if (jwe && privateKey && Number(expiry ?? 0) > Date.now() + 60_000) {
      _cached = { jwe, privateKey, cipher: cipher || 'ED25519', keyId: keyId || undefined, expiry: Number(expiry) };
      return _cached;
    }
  }
  _cached = await createSigningKey(sb);
  return _cached;
}

function importPrivateKey(privateKey: string): crypto.KeyObject {
  const clean = privateKey.trim();
  if (clean.includes('BEGIN')) return crypto.createPrivateKey(clean);
  try {
    return crypto.createPrivateKey({ key: Buffer.from(clean, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    const pem = `-----BEGIN PRIVATE KEY-----\n${clean.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    return crypto.createPrivateKey(pem);
  }
}

/**
 * Build the eBay digital-signature headers for a request (RFC 9421). Covered
 * components: content-digest (bodies only), x-ebay-signature-key, @method,
 * @path, @authority. Returns the headers to merge into the fetch.
 */
export async function signEbayRequest(opts: { method: string; url: string; body?: string }): Promise<Record<string, string>> {
  const key = await getSigningKey();
  const u = new URL(opts.url);
  const method = opts.method.toUpperCase();
  const created = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {};
  const components: string[] = [];
  const baseLines: string[] = [];

  if (opts.body != null && opts.body.length > 0) {
    const digest = crypto.createHash('sha256').update(opts.body, 'utf8').digest('base64');
    const cd = `sha-256=:${digest}:`;
    headers['Content-Digest'] = cd;
    components.push('"content-digest"');
    baseLines.push(`"content-digest": ${cd}`);
  }

  headers['x-ebay-signature-key'] = key.jwe;
  components.push('"x-ebay-signature-key"');
  baseLines.push(`"x-ebay-signature-key": ${key.jwe}`);

  components.push('"@method"'); baseLines.push(`"@method": ${method}`);
  components.push('"@path"'); baseLines.push(`"@path": ${u.pathname}`);
  components.push('"@authority"'); baseLines.push(`"@authority": ${u.host}`);

  const params = `(${components.join(' ')});created=${created}`;
  baseLines.push(`"@signature-params": ${params}`);
  const signatureBase = baseLines.join('\n');

  const pk = importPrivateKey(key.privateKey);
  // ED25519 signs with a null digest; RSA falls back to PKCS#1 v1.5 + SHA-256.
  const signature = key.cipher.toUpperCase().includes('ED25519')
    ? crypto.sign(null, Buffer.from(signatureBase, 'utf8'), pk)
    : crypto.sign('sha256', Buffer.from(signatureBase, 'utf8'), pk);

  headers['Signature-Input'] = `sig1=${params}`;
  headers['Signature'] = `sig1=:${signature.toString('base64')}:`;
  return headers;
}
