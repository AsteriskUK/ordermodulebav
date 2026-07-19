import { getServiceClient } from '@/lib/supabase-admin';

export function getSupabase() {
  return getServiceClient();
}

export async function getSetting(k: string): Promise<string | null> {
  const { data } = await getSupabase().from('app_settings').select('value').eq('key', k).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(k: string, v: string) {
  await getSupabase().from('app_settings').upsert({ key: k, value: v, updated_at: new Date().toISOString() });
}

export function extractSummaryFromDetail(detail: Record<string, unknown>) {
  const summary = (detail.summary as Record<string, unknown> | undefined) || detail;
  const creationInfo = (summary.creationInfo as Record<string, unknown> | undefined) || {};
  const item = (creationInfo.item as Record<string, unknown> | undefined) || {};
  const refund = ((summary.sellerTotalRefund as Record<string, unknown> | undefined)?.estimatedRefundAmount as Record<string, unknown> | undefined) ||
                 ((summary.sellerTotalRefund as Record<string, unknown> | undefined)?.refundAmount as Record<string, unknown> | undefined);

  return {
    state: (summary.state as string | undefined) || null,
    status: (summary.status as string | undefined) || null,
    return_type: (summary.currentType as string | undefined) || null,
    reason: (creationInfo.reason as string | undefined) || null,
    reason_type: (creationInfo.reasonType as string | undefined) || null,
    refund_amount: (refund?.value as number | undefined) || null,
    currency: (refund?.currency as string | undefined) || null,
    creation_date: ((creationInfo.creationDate as Record<string, unknown> | undefined)?.value as string | undefined) || null,
    buyer_login: (summary.buyerLoginName as string | undefined) || null,
    item_id: (item.itemId as string | undefined) || null,
  };
}

export async function updateEbayReturnRow(id: string, detail: Record<string, unknown>) {
  const fields = extractSummaryFromDetail(detail);
  await getSupabase().from('ebay_returns').update({ ...fields, raw: detail, updated_at: new Date().toISOString() }).eq('return_id', id);
}
