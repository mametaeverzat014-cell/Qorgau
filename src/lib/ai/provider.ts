/**
 * AIExplanationProvider — the optional AI layer.
 *
 * DESIGN RULE, non-negotiable:
 *   The recommendation engine never calls this. Diagnostics, matching, ranking,
 *   comparison, the roadmap, the next action and progress tracking are all
 *   deterministic and complete before this module is ever touched.
 *
 * All this layer does is take explanations the engine ALREADY produced and
 * rewrite them in warmer, more natural prose. If the API key is missing, the
 * request fails, the network is down, or the response is malformed, the caller
 * receives the deterministic text unchanged and the product is unaffected.
 *
 * The API key lives only in the server-side route handler at
 * src/app/api/explain/route.ts. It is never shipped to the browser.
 */

export interface ExplanationRequest {
  /** What the engine already concluded — the AI may rephrase, never contradict. */
  facts: {
    universityName: string;
    matchScore: number;
    category: string;
    reasons: string[];
    concerns: string[];
    intendedMajor: string;
    budgetUSD: number;
    aidNeed: string;
  };
  /** The deterministic sentence the engine produced. Always the fallback. */
  fallback: string;
}

export interface ExplanationResult {
  text: string;
  /** 'ai' when the model produced it, 'deterministic' in every other case. */
  source: 'ai' | 'deterministic';
  /** Populated when we fell back, so the UI can be honest about why. */
  note?: string;
}

export interface AIExplanationProvider {
  explain(req: ExplanationRequest): Promise<ExplanationResult>;
}

/** The provider used when no AI is configured. Always available, always instant. */
export class DeterministicProvider implements AIExplanationProvider {
  async explain(req: ExplanationRequest): Promise<ExplanationResult> {
    return { text: req.fallback, source: 'deterministic' };
  }
}

/**
 * Calls our own server route, which holds the key. The browser never sees it.
 * Any failure at all resolves to the deterministic fallback — this method does
 * not reject.
 */
export class ServerRouteProvider implements AIExplanationProvider {
  constructor(private timeoutMs = 9000) {}

  async explain(req: ExplanationRequest): Promise<ExplanationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          text: req.fallback,
          source: 'deterministic',
          note: `AI layer unavailable (${res.status}) — showing the engine's own explanation.`,
        };
      }
      const data = (await res.json()) as { text?: string; source?: string };
      if (typeof data.text !== 'string' || data.text.trim().length < 20) {
        return {
          text: req.fallback,
          source: 'deterministic',
          note: 'AI response was empty or malformed — showing the engine’s own explanation.',
        };
      }
      return { text: data.text.trim(), source: data.source === 'ai' ? 'ai' : 'deterministic' };
    } catch {
      return {
        text: req.fallback,
        source: 'deterministic',
        note: 'AI layer unreachable — showing the engine’s own explanation.',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const aiProvider: AIExplanationProvider = new ServerRouteProvider();
