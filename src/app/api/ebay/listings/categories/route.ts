import { NextRequest, NextResponse } from 'next/server';
import { getEbayAppToken, EBAY_BASE_URL, EBAY_MARKETPLACE_ID } from '@/lib/ebay-client';

// EBAY_GB category tree ID (stable, defined by eBay)
const EBAY_GB_TREE_ID = '3';

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const token = await getEbayAppToken();
  if (!token) {
    return NextResponse.json({ error: 'app_token_failed' }, { status: 500 });
  }

  const url = `${EBAY_BASE_URL}/commerce/taxonomy/v1/category_tree/${EBAY_GB_TREE_ID}/get_category_suggestions?q=${encodeURIComponent(q)}&marketplace_id=${EBAY_MARKETPLACE_ID}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: 'taxonomy_api_error', message: body }, { status: res.status });
  }

  const data = await res.json() as {
    categorySuggestions?: {
      category: { categoryId: string; categoryName: string };
      categoryTreeNodeAncestors?: { categoryName: string }[];
    }[];
  };

  const suggestions = (data.categorySuggestions ?? []).slice(0, 10).map((s) => {
    const ancestors = (s.categoryTreeNodeAncestors ?? [])
      .map((a) => a.categoryName)
      .reverse()
      .join(' > ');
    return {
      categoryId: s.category.categoryId,
      categoryName: s.category.categoryName,
      breadcrumb: ancestors ? `${ancestors} > ${s.category.categoryName}` : s.category.categoryName,
    };
  });

  return NextResponse.json({ suggestions });
}
