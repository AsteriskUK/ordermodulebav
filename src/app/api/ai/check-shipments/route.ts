import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  const { orders } = await req.json() as {
    orders: {
      id: string;
      salesRecordNumber: string;
      itemTitle: string;
      postToName: string;
      postToAddress1: string;
      postToCity: string;
      postToPostcode: string;
      postToCountry: string;
      totalPrice: number;
      deliveryCarrier: string;
    }[];
  };

  if (!orders?.length) {
    return NextResponse.json({ issues: [] });
  }

  const orderLines = orders.map((o) =>
    `[${o.id}] #${o.salesRecordNumber} | ${o.itemTitle.slice(0, 50)} | ${o.postToName} | ${o.postToAddress1}, ${o.postToCity}, ${o.postToPostcode}, ${o.postToCountry} | £${o.totalPrice} | carrier: ${o.deliveryCarrier}`
  ).join('\n');

  const prompt = `You are a shipment quality checker for a UK eBay order fulfilment company.

Review the following orders for potential problems BEFORE shipping labels are booked. Flag only genuine concerns — do not flag everything.

Check for:
1. UK postcodes that look malformed (wrong format, obviously fake like "AA1 1AA" or "TEST")
2. Missing or very short address (e.g. address1 is just a number or initials)
3. International orders (non-GB country) going via a domestic-only carrier
4. Unusually high value (over £2000) items being sent without attention noted
5. Obviously mismatched data (e.g. country says "United Kingdom" but postcode is not UK format)

Orders:
${orderLines}

Respond with ONLY a JSON array. Each element must be: {"id":"<order id>","issue":"<short description of the problem>"}
If no issues found, return []. Do not flag minor things. Only flag genuine blockers.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
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
    const issues = JSON.parse(raw);
    return NextResponse.json({ issues: Array.isArray(issues) ? issues : [] });
  } catch {
    return NextResponse.json({ issues: [] });
  }
}
