import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Optional AI rewrite endpoint.
 *
 * Holds ANTHROPIC_API_KEY server-side — it is never sent to the browser. If the
 * key is absent this route immediately reports that no AI is configured, and the
 * client falls back to the engine's deterministic explanation. The product works
 * identically either way; nothing downstream depends on this route succeeding.
 */

interface Body {
  facts?: {
    universityName?: string;
    matchScore?: number;
    category?: string;
    reasons?: string[];
    concerns?: string[];
    intendedMajor?: string;
    budgetUSD?: number;
    aidNeed?: string;
  };
  fallback?: string;
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const fallback = typeof body.fallback === 'string' ? body.fallback : '';
  const facts = body.facts;

  if (!facts?.universityName || !fallback) {
    return NextResponse.json({ error: 'Missing facts or fallback' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not an error state. The product is designed to run without a key.
    return NextResponse.json({ text: fallback, source: 'deterministic', reason: 'no-api-key' });
  }

  const prompt = [
    'You are rewriting an explanation for a university admissions tool.',
    '',
    'Rewrite the DRAFT below as 2-3 warm, direct sentences addressed to the student.',
    '',
    'Absolute rules:',
    '- Use ONLY the facts provided. Introduce no new figures, rankings, deadlines or claims.',
    '- Never state or imply a probability of admission.',
    '- Keep every caveat present in the draft. Do not make it sound more certain.',
    '- Plain language, no marketing tone, no exclamation marks.',
    '- Return only the rewritten text, nothing else.',
    '',
    `University: ${facts.universityName}`,
    `Match score (alignment, not admission odds): ${facts.matchScore}`,
    `Category: ${facts.category}`,
    `Student's intended major: ${facts.intendedMajor}`,
    `Student's annual budget (USD): ${facts.budgetUSD}`,
    `Student's funding requirement: ${facts.aidNeed}`,
    `Reasons it matches: ${(facts.reasons ?? []).join(' | ')}`,
    `Concerns: ${(facts.concerns ?? []).join(' | ')}`,
    '',
    `DRAFT: ${fallback}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ text: fallback, source: 'deterministic', reason: `upstream-${res.status}` });
    }

    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text?.trim();

    if (!text || text.length < 20) {
      return NextResponse.json({ text: fallback, source: 'deterministic', reason: 'empty-response' });
    }
    return NextResponse.json({ text, source: 'ai' });
  } catch {
    // Network failure, timeout, upstream outage — the student still gets an answer.
    return NextResponse.json({ text: fallback, source: 'deterministic', reason: 'request-failed' });
  }
}
