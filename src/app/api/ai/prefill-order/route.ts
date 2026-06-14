import { NextRequest, NextResponse } from 'next/server';
import { CATEGORIES } from '@/lib/categoriser';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  const { description } = await req.json() as { description: string };
  if (!description?.trim()) {
    return NextResponse.json({ error: 'description required' }, { status: 400 });
  }

  const categoryList = CATEGORIES.join(', ');

  const prompt = `You are an order entry assistant for a UK IT refurbishment warehouse (BAV IT).
The user has described an order in free text. Extract structured fields from it.

Categories available: ${categoryList}

User description:
"""
${description}
"""

Return ONLY a JSON object with these fields (omit any you cannot determine):
{
  "itemTitle": "full item description",
  "customLabel": "SKU or item code if mentioned",
  "variation": "spec variation e.g. 16GB/256GB",
  "quantity": 1,
  "soldFor": 0.00,
  "postageAndPackaging": 0.00,
  "totalPrice": 0.00,
  "category": "one of the categories above",
  "buyerName": "",
  "buyerEmail": "",
  "buyerUsername": "",
  "postToName": "",
  "postToAddress1": "",
  "postToAddress2": "",
  "postToCity": "",
  "postToCounty": "",
  "postToPostcode": "",
  "postToCountry": "United Kingdom",
  "postToPhone": "",
  "deliveryCarrier": "DPD",
  "deliveryType": "standard",
  "salesRecordNumber": "",
  "comments": ""
}

Rules:
- deliveryType must be one of: standard, next_day, express, collection
- deliveryCarrier must be one of: DPD, FedEx, Parcelforce, Royal Mail, Other
- postToPostcode should be uppercase UK format
- totalPrice = soldFor + postageAndPackaging if not explicitly stated
- Only include fields you are reasonably confident about`;

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
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 502 });
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content?.trim() ?? '{}';

  try {
    const fields = JSON.parse(raw);
    return NextResponse.json({ fields });
  } catch {
    return NextResponse.json({ fields: {} });
  }
}
