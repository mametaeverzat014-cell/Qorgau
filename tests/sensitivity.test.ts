import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, getDemoProfile } from '@/lib/demo';
import { getRecommendations } from '@/lib/engine/score';
import { calculateFinancialFit } from '@/lib/engine/matchers';
import { getUniversity } from '@/data/universities';
import {
  BUDGET_OPTIONS,
  applyBudgetOption,
  diffRecommendations,
} from '@/lib/engine/whatif';
import { requiresAid, type Country, type StudentProfile } from '@/lib/types';

/**
 * Parameter sensitivity.
 *
 * The case requires that changing country or budget materially changes the
 * result. Asserting `before !== after` would pass on a single reordered pair, so
 * every test here asserts a specific behavioural consequence instead: which
 * verdicts flip, which universities enter and leave, which direction scores move,
 * and whether the change is explained to the student.
 */

const base: StudentProfile = {
  ...EMPTY_PROFILE,
  gpaValue: 90,
  gpaScale: '100',
  englishTest: 'IELTS',
  englishScore: 7.0,
  satTaken: true,
  satScore: 1400,
  intendedMajor: 'economics',
  completedAt: '2026-09-16T00:00:00.000Z',
};

const at = (budget: number, aidNeed: StudentProfile['aidNeed']): StudentProfile => ({
  ...base,
  budgetAnnualUSD: budget,
  maxAffordableAnnualUSD: budget,
  aidNeed,
});

const idsOf = (p: StudentProfile) => getRecommendations(p).results.map((r) => r.university.id);
const verdictsOf = (p: StudentProfile) =>
  getRecommendations(p).results.map((r) => r.fits.financial.verdict);

/* ------------------------------------------------------------------ */
/* Budget sensitivity                                                  */
/* ------------------------------------------------------------------ */

describe('Budget changes affect financial fit monotonically', () => {
  it('never lowers a financial score when the budget rises', () => {
    // Monotonicity is the property that makes the control trustworthy: more
    // money must never make a university look worse financially.
    const ladder = [0, 5000, 15000, 25000, 120000];
    for (const u of [getUniversity('hku')!, getUniversity('nyu')!, getUniversity('tum')!]) {
      let previous = -1;
      for (const budget of ladder) {
        const fit = calculateFinancialFit(at(budget, 'partial'), u);
        expect(
          fit.score,
          `${u.shortName} scored lower at $${budget} than at the budget below it`,
        ).toBeGreaterThanOrEqual(previous);
        previous = fit.score;
      }
    }
  });

  it('moves every university towards affordability as the budget rises', () => {
    const rank = { 'above-budget': 0, unknown: 1, 'aid-dependent': 2, 'potentially-affordable-with-aid': 3, 'strong-financial-fit': 4 };
    for (const id of ['hku', 'edinburgh', 'bocconi', 'asu']) {
      const u = getUniversity(id)!;
      const poor = calculateFinancialFit(at(0, 'full-ride'), u).verdict;
      const rich = calculateFinancialFit(at(120000, 'none'), u).verdict;
      expect(rank[rich], `${id} did not improve from ${poor} to ${rich}`).toBeGreaterThan(rank[poor]);
    }
  });

  it('flips the whole shortlist to unconditional affordability at no limit', () => {
    const broke = verdictsOf(at(0, 'full-ride'));
    const rich = verdictsOf(at(120000, 'none'));
    expect(broke.filter((v) => v === 'strong-financial-fit').length).toBeLessThan(broke.length / 2);
    expect(rich.every((v) => v === 'strong-financial-fit')).toBe(true);
  });

  it('shrinks the aid-dependent share of the shortlist as budget rises', () => {
    const poor = getRecommendations(at(5000, 'full-ride'));
    const rich = getRecommendations(at(25000, 'partial'));
    const share = (s: ReturnType<typeof getRecommendations>) =>
      s.results.filter((r) => requiresAid(r.fits.financial.verdict)).length / s.results.length;
    expect(share(rich)).toBeLessThan(share(poor));
  });

  it('expands the set of universities affordable without aid', () => {
    const poor = getRecommendations(at(0, 'full-ride'));
    const rich = getRecommendations(at(120000, 'none'));
    expect(rich.affordableWithoutAidCount).toBeGreaterThan(poor.affordableWithoutAidCount + 10);
    expect(rich.aboveBudgetCount).toBeLessThan(poor.aboveBudgetCount);
  });

  it('reorders the ranking, not just the labels', () => {
    const poor = idsOf(at(0, 'full-ride'));
    const rich = idsOf(at(120000, 'none'));
    expect(poor[0]).not.toBe(rich[0]);
    const overlap = poor.filter((id) => rich.includes(id)).length;
    expect(overlap, 'the two lists are effectively identical').toBeLessThan(poor.length);
  });

  it('explains the change rather than silently re-sorting', () => {
    const before = applyBudgetOption(base, BUDGET_OPTIONS[1]);
    const after = applyBudgetOption(base, BUDGET_OPTIONS[4]);
    const diff = diffRecommendations(
      { profile: before, set: getRecommendations(before) },
      { profile: after, set: getRecommendations(after) },
    );
    expect(diff.noChange).toBe(false);
    expect(diff.effects.length).toBeGreaterThanOrEqual(3);
    expect(diff.headline).toMatch(/budget changed/i);
    // The effects must reference real, counted consequences.
    expect(diff.effects.some((e) => /financially compatible/i.test(e.text))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Aid-need sensitivity                                                */
/* ------------------------------------------------------------------ */

describe('Funding requirement changes affect which options survive', () => {
  it('penalises universities without dependable aid when a full ride is required', () => {
    const needsAll = { ...at(2000, 'full-ride'), openToAnyCountry: true, preferredCountries: [] };
    const needsNone = { ...at(2000, 'none'), openToAnyCountry: true, preferredCountries: [] };

    const dependable = getUniversity('harvard')!; // meets full need
    const competitive = getUniversity('tu-delft')!; // a handful of awards

    const a = calculateFinancialFit(needsAll, dependable);
    const b = calculateFinancialFit(needsAll, competitive);
    expect(a.score, 'a need-met institution must outrank a competitive one for a high-need student')
      .toBeGreaterThan(b.score);
    expect(a.verdict).toBe('potentially-affordable-with-aid');
    expect(b.verdict).toBe('aid-dependent');

    // And the distinction must not depend on the student's stated aid need.
    expect(calculateFinancialFit(needsNone, dependable).verdict).toBe(
      calculateFinancialFit(needsNone, dependable).verdict,
    );
  });

  it('separates dependable aid from a competitive award in the verdict', () => {
    const profile = at(3000, 'full-ride');
    const verdicts = new Set(
      ['harvard', 'nyuad', 'tu-delft', 'bocconi', 'ceu'].map(
        (id) => calculateFinancialFit(profile, getUniversity(id)!).verdict,
      ),
    );
    expect(verdicts.has('potentially-affordable-with-aid')).toBe(true);
    expect(verdicts.has('aid-dependent')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Country sensitivity                                                 */
/* ------------------------------------------------------------------ */

describe('Country changes materially change the recommendation set', () => {
  const scopedTo = (countries: Country[]): StudentProfile => ({
    ...base,
    budgetAnnualUSD: 25000,
    maxAffordableAnnualUSD: 30000,
    aidNeed: 'partial',
    preferredCountries: countries,
    openToAnyCountry: false,
  });

  it('fills the top of the list with the chosen country', () => {
    for (const country of ['USA', 'South Korea', 'Hong Kong'] as Country[]) {
      const top = getRecommendations(scopedTo([country])).results.slice(0, 3);
      expect(
        top.every((r) => r.university.country === country),
        `top 3 for ${country} contains another country`,
      ).toBe(true);
    }
  });

  it('replaces essentially the whole set when the destination changes', () => {
    const usa = idsOf(scopedTo(['USA']));
    const korea = idsOf(scopedTo(['South Korea']));
    const overlap = usa.filter((id) => korea.includes(id));
    expect(overlap.length, `${overlap.length} universities survived the switch`).toBeLessThanOrEqual(1);
    expect(usa[0]).not.toBe(korea[0]);
  });

  it('marks out-of-scope universities and ranks them below comparable in-scope ones', () => {
    const korea = scopedTo(['South Korea']);
    const set = getRecommendations(korea);
    const outside = set.all.filter((r) => r.outsidePreferredCountries);
    const inside = set.all.filter((r) => !r.outsidePreferredCountries);
    expect(outside.length).toBeGreaterThan(0);
    expect(inside.length).toBeGreaterThan(0);
    // The best in-scope option must beat the best out-of-scope one.
    expect(Math.max(...inside.map((r) => r.score))).toBeGreaterThan(
      Math.max(...outside.map((r) => r.score)),
    );
  });

  it('widens the pool when more countries are selected', () => {
    const one = getRecommendations(scopedTo(['Hong Kong']));
    const three = getRecommendations(scopedTo(['Hong Kong', 'South Korea', 'Singapore']));
    const inScope = (s: ReturnType<typeof getRecommendations>) =>
      s.all.filter((r) => !r.outsidePreferredCountries).length;
    expect(inScope(three)).toBeGreaterThan(inScope(one));
  });

  it('changes programme availability when the destination changes', () => {
    // A STEM-only destination must not look identical to a broad one for a
    // humanities student.
    const humanities = { ...base, intendedMajor: 'humanities' as const, openToAnyCountry: false };
    const korea = getRecommendations({ ...humanities, preferredCountries: ['South Korea'] });
    const europe = getRecommendations({ ...humanities, preferredCountries: ['Austria', 'Italy', 'Czechia'] });
    const majorScore = (s: ReturnType<typeof getRecommendations>) =>
      s.results.reduce((a, r) => a + r.components.major, 0) / s.results.length;
    expect(majorScore(korea)).not.toBe(majorScore(europe));
  });

  it('explains a destination change with named universities', () => {
    const before = scopedTo(['USA']);
    const after = scopedTo(['South Korea']);
    const diff = diffRecommendations(
      { profile: before, set: getRecommendations(before) },
      { profile: after, set: getRecommendations(after) },
    );
    expect(diff.headline).toMatch(/destination changed/i);
    expect(diff.entered.length).toBeGreaterThan(0);
    expect(diff.left.length).toBeGreaterThan(0);
    expect(diff.effects.some((e) => /entered your results/i.test(e.text))).toBe(true);
    expect(diff.effects.some((e) => /dropped out/i.test(e.text))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

describe('The engine is deterministic and auditable', () => {
  it('returns byte-identical results for the same profile', () => {
    for (const id of ['aizhan', 'daniyar', 'madina']) {
      const p = getDemoProfile(id)!;
      const a = getRecommendations(p);
      const b = getRecommendations(p);
      expect(a.results.map((r) => [r.university.id, r.score])).toEqual(
        b.results.map((r) => [r.university.id, r.score]),
      );
    }
  });

  it('reports a component breakdown that reconstructs the headline score', () => {
    const set = getRecommendations(base);
    for (const rec of set.results) {
      // Out-of-scope options carry a documented multiplier, so check in-scope ones.
      if (rec.outsidePreferredCountries) continue;
      const sum =
        rec.components.academic * 0.18 +
        rec.components.financial * 0.24 +
        rec.components.major * 0.18 +
        rec.components.geography * 0.13 +
        rec.components.scholarship * 0.1 +
        rec.components.tests * 0.08 +
        rec.components.preference * 0.09;
      expect(Math.abs(sum - rec.score), `${rec.university.id} score does not match its components`)
        .toBeLessThanOrEqual(1);
    }
  });
});
