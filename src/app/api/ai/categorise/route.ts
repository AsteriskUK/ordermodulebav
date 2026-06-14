import { NextRequest, NextResponse } from 'next/server';
import { CATEGORIES } from '@/lib/categoriser';

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 503 });
  }

  const { items } = await req.json() as { items: { id: string; title: string }[] };

  if (!items?.length) {
    return NextResponse.json({ results: [] });
  }

  const categoryList = CATEGORIES.join(', ');
  const itemLines = items.map((item, i) => `${i + 1}. [${item.id}] ${item.title}`).join('\n');

  const prompt = `You are a warehouse categorisation assistant for a UK IT refurbishment company.

Classify each item title into EXACTLY one of these categories:
${categoryList}

Category definitions:
- PC-GAMING: Gaming desktops/towers with discrete GPU (RTX/GTX/RX), or explicitly labelled "gaming PC"
- PC-AIO-MINI: Business desktops, all-in-ones, SFF/mini PCs, workstations WITHOUT gaming GPU
- LAPTOP: All laptops, notebooks, toughbooks, 2-in-1s, MacBooks
- MONITOR: Standalone display screens/monitors
- PROJECTOR: Projectors, projector accessories
- MB/RAM/HDD/SSD: Components, drives, RAM, motherboards, accessories, peripherals
- NETWORKING: Switches, routers, UPS, network hardware
- N/A: Cannot be determined

Items to classify:
${itemLines}

Respond with ONLY a JSON array where each element is {"id":"<id>","category":"<CATEGORY>"}. No explanation.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
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
    const results = JSON.parse(raw);
    const valid = Array.isArray(results)
      ? results.filter((r) => r.id && CATEGORIES.includes(r.category))
      : [];
    return NextResponse.json({ results: valid });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
