import { describe, expect, it } from 'vitest';
import { DEMO_PROFILES, EMPTY_PROFILE, getDemoProfile } from '@/lib/demo';
import { buildDiagnostics } from '@/lib/engine/diagnostics';
import { buildComparison } from '@/lib/engine/compare';
import { buildRoadmap, groupByMonth, upcomingDeadlines } from '@/lib/engine/roadmap';
import { getRecommendations } from '@/lib/engine/score';
import {
  BUDGET_OPTIONS,
  applyBudgetOption,
  diffRecommendations,
  nearestBudgetOption,
} from '@/lib/engine/whatif';
import { DeterministicProvider, ServerRouteProvider } from '@/lib/ai/provider';
import type { StudentProfile } from '@/lib/types';

const TODAY = new Date('2026-09-16T00:00:00Z');

const base: StudentProfile = {
  ...EMPTY_PROFILE,
  gpaValue: 90,
  gpaScale: '100',
  englishTest: 'IELTS',
  englishScore: 7.0,
  satTaken: true,
  satScore: 1400,
  completedAt: '2026-09-16T00:00:00.000Z',
};

/* ------------------------------------------------------------------ */
/* Copy quality — the class of bug that reaches a judge's eye          */
/* ------------------------------------------------------------------ */

describe('Generated copy never leaks raw data', () => {
  it('shows no ISO dates in any task title, description or rationale', () => {
    for (const demo of DEMO_PROFILES) {
      const profile = getDemoProfile(demo.id)!;
      const set = getRecommendations(profile);
      const tasks = buildRoadmap(profile, set.results, buildDiagnostics(profile, set), TODAY);
      for (const t of tasks) {
        const copy = `${t.title} ${t.description} ${t.rationale}`;
        expect(copy, `raw ISO date in task ${t.id}`).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(copy, `unresolved template in task ${t.id}`).not.toMatch(/\$\{|undefined|NaN|\[object/);
      }
    }
  });

  it('produces no undefined or NaN in any recommendation explanation', () => {
    for (const demo of DEMO_PROFILES) {
      const set = getRecommendations(getDemoProfile(demo.id)!);
      for (const rec of set.results) {
        const copy = `${rec.summary} ${rec.reasons.join(' ')} ${rec.concerns.join(' ')}`;
        expect(copy).not.toMatch(/undefined|NaN|\[object|\$\{/);
        expect(copy).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it('never claims an admission probability anywhere in generated text', () => {
    const banned = /chance of admission|probability of (?:being )?admi|likelihood of admission|you will get in|guaranteed admission/i;
    for (const demo of DEMO_PROFILES) {
      const profile = getDemoProfile(demo.id)!;
      const set = getRecommendations(profile);
      const diag = buildDiagnostics(profile, set);
      const tasks = buildRoadmap(profile, set.results, diag, TODAY);
      const corpus = [
        ...set.results.flatMap((r) => [r.summary, ...r.reasons, ...r.concerns]),
        ...diag.insights,
        ...diag.dimensions.map((d) => d.detail),
        ...tasks.flatMap((t) => [t.title, t.description, t.rationale]),
      ].join(' ');
      expect(corpus).not.toMatch(banned);
    }
  });
});

/* ------------------------------------------------------------------ */
/* What-if controls                                                    */
/* ------------------------------------------------------------------ */

describe('What-if controls keep the profile internally consistent', () => {
  it('relaxes the funding requirement as the budget rises', () => {
    const poor = applyBudgetOption(base, BUDGET_OPTIONS[0]);
    const rich = applyBudgetOption(base, BUDGET_OPTIONS[4]);
    expect(poor.aidNeed).toBe('full-ride');
    expect(rich.aidNeed).toBe('none');
    expect(rich.maxAffordableAnnualUSD).toBeGreaterThan(poor.maxAffordableAnnualUSD);
  });

  it('never leaves the ceiling below the stated budget', () => {
    for (const opt of BUDGET_OPTIONS) {
      const p = applyBudgetOption(base, opt);
      expect(p.maxAffordableAnnualUSD).toBeGreaterThanOrEqual(p.budgetAnnualUSD);
    }
  });

  it('reports both halves of a budget change in the diff headline', () => {
    const before = applyBudgetOption(base, BUDGET_OPTIONS[1]);
    const after = applyBudgetOption(base, BUDGET_OPTIONS[4]);
    const diff = diffRecommendations(
      { profile: before, set: getRecommendations(before) },
      { profile: after, set: getRecommendations(after) },
    );
    expect(diff.headline).toMatch(/budget changed/i);
    expect(diff.headline).toMatch(/funding requirement changed/i);
  });

  it('selects the nearest preset for an arbitrary profile budget', () => {
    expect(
      nearestBudgetOption({ ...base, budgetAnnualUSD: 9000, maxAffordableAnnualUSD: 9000 }).value,
    ).toBe(10000);
    expect(
      nearestBudgetOption({ ...base, budgetAnnualUSD: 200, maxAffordableAnnualUSD: 200 }).value,
    ).toBe(0);
    // It reads the ceiling, not the comfortable budget, so a stretchable family
    // is offered the preset matching what they could actually pay.
    expect(
      nearestBudgetOption({ ...base, budgetAnnualUSD: 200, maxAffordableAnnualUSD: 24000 }).value,
    ).toBe(25000);
  });

  it('honestly reports when a change moved nothing', () => {
    const set = getRecommendations(base);
    const diff = diffRecommendations({ profile: base, set }, { profile: base, set });
    expect(diff.noChange).toBe(true);
    expect(diff.entered).toHaveLength(0);
    expect(diff.left).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Comparison differentiates                                           */
/* ------------------------------------------------------------------ */

describe('Comparison does more than repeat the cards', () => {
  it('expresses advantage and concern relative to the compared set', () => {
    const set = getRecommendations({ ...base, openToAnyCountry: true, budgetAnnualUSD: 30000, maxAffordableAnnualUSD: 45000 });
    const rows = buildComparison(set.results.slice(0, 3));
    const advantage = rows.find((r) => r.key === 'advantage')!;
    const concern = rows.find((r) => r.key === 'concern')!;
    expect(advantage.label).toMatch(/vs these options/i);
    expect(concern.label).toMatch(/vs these options/i);
    // With three genuinely different universities the advantages should differ.
    const uniqueAdvantages = new Set(advantage.values.map((v) => v.display));
    expect(uniqueAdvantages.size).toBeGreaterThan(1);
  });

  it('degrades gracefully when only one university is compared', () => {
    const set = getRecommendations(base);
    const rows = buildComparison(set.results.slice(0, 1));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row.values).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Roadmap structure                                                   */
/* ------------------------------------------------------------------ */

describe('Roadmap structure', () => {
  it('groups tasks into chronological month buckets', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    const months = groupByMonth(tasks);
    expect(months.length).toBeGreaterThan(1);
    const keys = months.map((m) => m.monthKey);
    expect([...keys].sort()).toEqual(keys);
    expect(months.reduce((n, m) => n + m.tasks.length, 0)).toBe(tasks.length);
    for (const m of months) expect(m.label).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  });

  it('gives every task a non-empty rationale so nothing looks hard-coded', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    for (const t of tasks) {
      expect(t.rationale.length).toBeGreaterThan(15);
      expect(t.description.length).toBeGreaterThan(15);
    }
  });

  it('drops completed tasks from the upcoming deadline list', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    const before = upcomingDeadlines(tasks, {});
    expect(before.length).toBeGreaterThan(0);
    const after = upcomingDeadlines(tasks, { [before[0].id]: true });
    expect(after.map((t) => t.id)).not.toContain(before[0].id);
  });
});

/* ------------------------------------------------------------------ */
/* AI layer never breaks the product                                   */
/* ------------------------------------------------------------------ */

describe('AI layer is strictly additive', () => {
  const req = {
    facts: {
      universityName: 'Test University',
      matchScore: 80,
      category: 'Strong Match',
      reasons: ['a reason'],
      concerns: ['a concern'],
      intendedMajor: 'Economics',
      budgetUSD: 5000,
      aidNeed: 'full-ride',
    },
    fallback: 'This is the deterministic explanation produced by the engine itself.',
  };

  it('returns the deterministic text when no AI is configured', async () => {
    const result = await new DeterministicProvider().explain(req);
    expect(result.text).toBe(req.fallback);
    expect(result.source).toBe('deterministic');
  });

  it('falls back instead of throwing when the network fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;
    try {
      const result = await new ServerRouteProvider(50).explain(req);
      expect(result.text).toBe(req.fallback);
      expect(result.source).toBe('deterministic');
      expect(result.note).toBeTruthy();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('falls back when the endpoint returns an error status', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch;
    try {
      const result = await new ServerRouteProvider(50).explain(req);
      expect(result.text).toBe(req.fallback);
      expect(result.source).toBe('deterministic');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('falls back when the response body is malformed or too short', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'too short' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )) as typeof fetch;
    try {
      const result = await new ServerRouteProvider(50).explain(req);
      expect(result.text).toBe(req.fallback);
      expect(result.source).toBe('deterministic');
    } finally {
      globalThis.fetch = original;
    }
  });
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

describe('The engine never crashes on degenerate input', () => {
  const degenerate: [string, Partial<StudentProfile>][] = [
    ['completely empty profile', {}],
    ['no GPA', { gpaValue: null }],
    ['no English test', { englishTest: 'none', englishScore: null }],
    ['zero budget and full-ride need', { budgetAnnualUSD: 0, maxAffordableAnnualUSD: 0, aidNeed: 'full-ride' }],
    ['ceiling below budget', { budgetAnnualUSD: 50000, maxAffordableAnnualUSD: 1000 }],
    ['absurd budget', { budgetAnnualUSD: 10_000_000, maxAffordableAnnualUSD: 10_000_000 }],
    ['no countries but not open', { preferredCountries: [], openToAnyCountry: false }],
    ['every country selected', { preferredCountries: ['USA', 'South Korea', 'Hong Kong'], openToAnyCountry: false }],
    ['English-only with a niche major', { englishTaughtOnly: true, intendedMajor: 'medicine-health' }],
  ];

  for (const [label, patch] of degenerate) {
    it(`handles: ${label}`, () => {
      const profile = { ...EMPTY_PROFILE, ...patch } as StudentProfile;
      const set = getRecommendations(profile);
      expect(set.results.length).toBeGreaterThanOrEqual(3);

      const diag = buildDiagnostics(profile, set);
      expect(diag.dimensions.length).toBeGreaterThan(0);

      const tasks = buildRoadmap(profile, set.results, diag, TODAY);
      expect(tasks.length).toBeGreaterThan(0);

      for (const rec of set.results) {
        expect(Number.isFinite(rec.score)).toBe(true);
        expect(rec.score).toBeGreaterThanOrEqual(0);
        expect(rec.score).toBeLessThanOrEqual(100);
      }
    });
  }
});
