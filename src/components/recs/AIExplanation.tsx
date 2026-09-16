'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { aiProvider } from '@/lib/ai/provider';
import { MAJOR_LABELS, type Recommendation, type StudentProfile } from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/engine/explain';
import { Badge, Button } from '@/components/ui';

/**
 * Optional AI rewrite of the engine's explanation.
 *
 * The deterministic text is rendered immediately and is never replaced by a
 * spinner. The AI version is additive: if it fails, is not configured, or times
 * out, the student keeps reading the engine's own words and is told why.
 */
export function AIExplanation({
  rec,
  profile,
}: {
  rec: Recommendation;
  profile: StudentProfile;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isAI, setIsAI] = useState(false);

  async function rewrite() {
    setState('loading');
    const result = await aiProvider.explain({
      facts: {
        universityName: rec.university.name,
        matchScore: rec.score,
        category: CATEGORY_LABELS[rec.category],
        reasons: rec.reasons,
        concerns: rec.concerns,
        intendedMajor: MAJOR_LABELS[profile.intendedMajor],
        budgetUSD: profile.budgetAnnualUSD,
        aidNeed: profile.aidNeed,
      },
      fallback: rec.summary,
    });
    setText(result.text);
    setIsAI(result.source === 'ai');
    setNote(result.note ?? (result.source === 'deterministic' ? 'No AI provider is configured, so this is the engine’s own explanation — unchanged and complete.' : null));
    setState('done');
  }

  return (
    <div className="mt-5 border-t border-line pt-5">
      {state === 'idle' && (
        <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] leading-[1.6] text-muted">
            Optional: have an AI rewrite the explanation above in plainer language. It may only rephrase
            what the engine already determined — it cannot change a recommendation or add a fact.
          </p>
          <Button size="sm" variant="secondary" onClick={rewrite} className="shrink-0">
            <Sparkles size={13} /> Rephrase with AI
          </Button>
        </div>
      )}

      {state === 'loading' && (
        <p className="flex items-center gap-2 text-[13.5px] text-muted">
          <Loader2 size={14} className="animate-spin" /> Rewriting…
        </p>
      )}

      {state === 'done' && text && (
        <div>
          <div className="mb-2.5 flex items-center gap-2">
            <Badge tone={isAI ? 'brand' : 'neutral'}>
              <Sparkles size={11} strokeWidth={2.2} />
              {isAI ? 'AI-rephrased' : 'Engine explanation'}
            </Badge>
          </div>
          <p className="text-[14.5px] leading-[1.7] text-ink-soft">{text}</p>
          {note && <p className="mt-2.5 text-[12.5px] leading-[1.55] text-faint">{note}</p>}
          <Button size="sm" variant="ghost" onClick={() => setState('idle')} className="mt-2">
            Hide
          </Button>
        </div>
      )}
    </div>
  );
}
