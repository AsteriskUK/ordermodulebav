import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  const { query, orders } = await req.json() as {
    query: string;
    orders: { id: string; salesRecordNumber: string; itemTitle: string; status: string; postToCity: string; postToPostcode: string; postToCountry: string; totalPrice: number; deliveryCarrier: string; category: string; buyerUsername: string; postToName: string }[];
  };

  if (!query?.trim() || !orders?.length) {
    return NextResponse.json({ ids: [] });
  }

  const orderList = orders
    .map((o) =>
      `ID:${o.id} | #${o.salesRecordNumber} | ${o.itemTitle.slice(0, 60)} | status:${o.status} | city:${o.postToCity} | postcode:${o.postToPostcode} | country:${o.postToCountry} | £${o.totalPrice} | carrier:${o.deliveryCarrier} | category:${o.category} | buyer:${o.buyerUsername} | name:${o.postToName}`
    )
    .join('\n');

  const prompt = `You are a warehouse order search assistant. Given a list of orders and a natural language query, return ONLY the IDs of matching orders as a JSON array of strings.

Query: "${query}"

Orders:
${orderList}

Respond with ONLY a valid JSON array of matching order IDs, e.g. ["id1","id2"]. If nothing matches, return []. Do not explain anything.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 502 });
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '[]';

  try {
    const ids = JSON.parse(raw);
    return NextResponse.json({ ids: Array.isArray(ids) ? ids : [] });
  } catch {
    return NextResponse.json({ ids: [] });
  }
}
