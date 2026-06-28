import { NextResponse } from 'next/server';
import { getEbayAccessToken, EBAY_BASE_URL, EBAY_MARKETPLACE_ID } from '@/lib/ebay-client';
import { EbayBusinessPolicy } from '@/lib/types';

async function fetchPolicy(token: string, endpoint: string) {
  const res = await fetch(
    `${EBAY_BASE_URL}/sell/account/v1/${endpoint}?marketplace_id=${EBAY_MARKETPLACE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
      },
    }
  );
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function GET() {
  const token = await getEbayAccessToken();
  if (!token) {
    return NextResponse.json({ error: 'not_connected' }, { status: 401 });
  }

  const [paymentRaw, returnRaw, fulfillmentRaw] = await Promise.all([
    fetchPolicy(token, 'payment_policy'),
    fetchPolicy(token, 'return_policy'),
    fetchPolicy(token, 'fulfillment_policy'),
  ]);

  // Detect scope / auth errors — eBay returns 403 or errors array when scope is missing
  for (const { ok, status, text } of [paymentRaw, returnRaw, fulfillmentRaw]) {
    if (!ok) {
      let parsed: { errors?: { message?: string }[] } = {};
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      const msg = parsed.errors?.[0]?.message ?? text.slice(0, 200);
      if (status === 403 || status === 401) {
        return NextResponse.json(
          { error: 'scope_missing', message: msg },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { error: 'account_api_error', message: msg, status },
        { status: 502 }
      );
    }
  }

  const paymentData = JSON.parse(paymentRaw.text);
  const returnData = JSON.parse(returnRaw.text);
  const fulfillmentData = JSON.parse(fulfillmentRaw.text);

  const policies: EbayBusinessPolicy[] = [
    ...((paymentData.paymentPolicies ?? []) as { paymentPolicyId: string; name: string }[]).map((p) => ({
      policyId: p.paymentPolicyId,
      name: p.name,
      policyType: 'PAYMENT' as const,
    })),
    ...((returnData.returnPolicies ?? []) as { returnPolicyId: string; name: string }[]).map((p) => ({
      policyId: p.returnPolicyId,
      name: p.name,
      policyType: 'RETURN_POLICY' as const,
    })),
    ...((fulfillmentData.fulfillmentPolicies ?? []) as { fulfillmentPolicyId: string; name: string }[]).map((p) => ({
      policyId: p.fulfillmentPolicyId,
      name: p.name,
      policyType: 'FULFILLMENT' as const,
    })),
  ];

  return NextResponse.json({ policies });
}
