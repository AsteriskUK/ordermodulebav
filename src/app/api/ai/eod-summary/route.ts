import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  const body = await req.json();
  const { date, shipped, packed, revenue, held, noStock, events, topItems } = body;

  const prompt = `You are writing a concise end-of-day warehouse operations summary for an eBay order fulfilment team.

Date: ${date}
Orders shipped: ${shipped}
Orders packed (ready for dispatch): ${packed}
Revenue dispatched: £${revenue}
Orders on hold: ${held}
Orders with no stock: ${noStock}
Total status changes today: ${events}
Top items shipped today: ${topItems?.join(', ') || 'N/A'}

Write a 3-4 sentence plain-English summary suitable for sharing with the team manager or in a group chat. Be factual, positive in tone, and flag any concerns (holds/no-stock) if relevant. Do not use bullet points. Do not say "Here is your summary".`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: `OpenAI error: ${err}` }, { status: 502 });
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content?.trim() ?? '';
  return NextResponse.json({ summary });
}
