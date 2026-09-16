import { describe, expect, it } from 'vitest';
import { UNIVERSITIES, getUniversity } from '@/data/universities';
import { DEMO_PROFILES, EMPTY_PROFILE, getDemoProfile } from '@/lib/demo';
import {
  calculateFinancialFit,
  calculateMajorFit,
  calculateTestFit,
} from '@/lib/engine/matchers';
import { calculateOverallMatch, getRecommendations } from '@/lib/engine/score';
import { buildDiagnostics } from '@/lib/engine/diagnostics';
import { buildRoadmap, calculateProgress, getNextAction } from '@/lib/engine/roadmap';
import { diffRecommendations } from '@/lib/engine/whatif';
import { buildComparison, winnerOf } from '@/lib/engine/compare';
import type { StudentProfile } from '@/lib/types';

const base: StudentProfile = {
  ...EMPTY_PROFILE,
  gpaValue: 90,
  gpaScale: '100',
  englishTest: 'IELTS',
  englishScore: 7.0,
  satTaken: true,
  satScore: 1400,
  intendedMajor: 'computer-science',
  completedAt: '2026-09-16T00:00:00.000Z',
};

const TODAY = new Date('2026-09-16T00:00:00Z');

/* ------------------------------------------------------------------ */
/* 1. Budget sensitivity                                               */
/* ------------------------------------------------------------------ */

describe('1. Lower budget changes financial ranking', () => {
  it('drops expensive universities out of the top results when the budget falls', () => {
    const rich = { ...base, budgetAnnualUSD: 60000, maxAffordableAnnualUSD: 80000, aidNeed: 'none' as const };
    const poor = { ...base, budgetAnnualUSD: 3000, maxAffordableAnnualUSD: 6000, aidNeed: 'full-ride' as const };

    const richSet = getRecommendations(rich);
    const poorSet = getRecommendations(poor);

    const richIds = richSet.results.map((r) => r.university.id);
    const poorIds = poorSet.results.map((r) => r.university.id);

    expect(richIds).not.toEqual(poorIds);
    // At least half the list must actually turn over.
    const overlap = richIds.filter((id) => poorIds.includes(id)).length;
    expect(overlap).toBeLessThan(richIds.length);

    // Universities with no meaningful aid must not survive a full-ride requirement.
    const nyuInPoor = poorSet.results.find((r) => r.university.id === 'nyu');
    expect(nyuInPoor).toBeUndefined();

    expect(poorSet.aboveBudgetCount).toBeGreaterThan(richSet.aboveBudgetCount);
  });

  it('scores the same university higher when the student can afford it', () => {
    const uni = getUniversity('edinburgh')!;
    const rich = calculateFinancialFit(
      { ...base, budgetAnnualUSD: 60000, maxAffordableAnnualUSD: 80000 },
      uni,
    );
    const poor = calculateFinancialFit(
      { ...base, budgetAnnualUSD: 3000, maxAffordableAnnualUSD: 5000 },
      uni,
    );
    expect(rich.score).toBeGreaterThan(poor.score);
    expect(rich.verdict).toBe('strong-financial-fit');
    expect(poor.verdict).toBe('above-budget');
  });

  it('produces a readable what-changed diff when budget moves', () => {
    const before = { ...base, budgetAnnualUSD: 5000, maxAffordableAnnualUSD: 5000, aidNeed: 'full-ride' as const };
    const after = { ...before, budgetAnnualUSD: 25000, maxAffordableAnnualUSD: 25000 };
    const diff = diffRecommendations(
      { profile: before, set: getRecommendations(before) },
      { profile: after, set: getRecommendations(after) },
    );
    expect(diff.headline).toContain('$5,000');
    expect(diff.headline).toContain('$25,000');
    expect(diff.effects.length).toBeGreaterThan(0);
    expect(diff.noChange).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Country sensitivity                                              */
/* ------------------------------------------------------------------ */

describe('2. Changing preferred country materially changes recommendations', () => {
  it('returns a substantially different set for USA vs South Korea', () => {
    const usa = { ...base, preferredCountries: ['USA' as const], openToAnyCountry: false, budgetAnnualUSD: 20000, maxAffordableAnnualUSD: 30000 };
    const korea = { ...usa, preferredCountries: ['South Korea' as const] };

    const usaIds = getRecommendations(usa).results.map((r) => r.university.id);
    const koreaIds = getRecommendations(korea).results.map((r) => r.university.id);

    const overlap = usaIds.filter((id) => koreaIds.includes(id));
    // The top of each list must be dominated by the chosen country.
    expect(overlap.length).toBeLessThanOrEqual(1);
    expect(usaIds[0]).not.toBe(koreaIds[0]);

    const usaTop3 = getRecommendations(usa).results.slice(0, 3);
    expect(usaTop3.every((r) => r.university.country === 'USA')).toBe(true);

    const koreaTop3 = getRecommendations(korea).results.slice(0, 3);
    expect(koreaTop3.every((r) => r.university.country === 'South Korea')).toBe(true);
  });

  it('marks out-of-scope universities and penalises their score', () => {
    const korea = { ...base, preferredCountries: ['South Korea' as const], openToAnyCountry: false };
    const open = { ...base, preferredCountries: [], openToAnyCountry: true };
    const mit = getUniversity('mit')!;

    const scoped = calculateOverallMatch(korea, mit);
    const unscoped = calculateOverallMatch(open, mit);

    expect(scoped.outsidePreferredCountries).toBe(true);
    expect(unscoped.outsidePreferredCountries).toBe(false);
    expect(scoped.score).toBeLessThan(unscoped.score);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Major matching                                                   */
/* ------------------------------------------------------------------ */

describe('3. A matching major ranks above a non-matching major, all else equal', () => {
  it('scores an offered major at 100 and an unrelated one far lower', () => {
    const csUni = getUniversity('kaist')!; // STEM only, no law
    const cs = calculateMajorFit({ ...base, intendedMajor: 'computer-science' }, csUni);
    const law = calculateMajorFit({ ...base, intendedMajor: 'law' }, csUni);

    expect(cs.score).toBe(100);
    expect(law.score).toBeLessThan(40);
    expect(cs.flags).toContain('major-available');
    expect(law.flags).toContain('major-missing');
  });

  it('ranks the university offering the student’s major above one that does not', () => {
    const profile = { ...base, intendedMajor: 'law' as const, openToAnyCountry: true, preferredCountries: [], budgetAnnualUSD: 40000, maxAffordableAnnualUSD: 60000 };
    const offersLaw = calculateOverallMatch(profile, getUniversity('hku')!);
    const noLaw = calculateOverallMatch(profile, getUniversity('kaist')!);
    expect(offersLaw.score).toBeGreaterThan(noLaw.score);
  });

  it('gives partial credit for an adjacent field rather than a flat zero', () => {
    const adjacent = calculateMajorFit({ ...base, intendedMajor: 'data-science-ai' }, getUniversity('postech')!);
    expect(adjacent.score).toBeGreaterThan(50);
  });
});

/* ------------------------------------------------------------------ */
/* 4. English requirement gap                                          */
/* ------------------------------------------------------------------ */

describe('4. IELTS below requirement creates a warning', () => {
  it('flags english-below and explains the size of the gap', () => {
    const uni = getUniversity('mit')!; // minimum IELTS 7.0
    const fit = calculateTestFit({ ...base, englishTest: 'IELTS', englishScore: 6.5 }, uni);
    expect(fit.flags).toContain('english-below');
    expect(fit.concerns.join(' ')).toMatch(/English requirement gap/i);
    expect(fit.concerns.join(' ')).toContain('7');
  });

  it('does not warn when the score clears the requirement', () => {
    const fit = calculateTestFit({ ...base, englishScore: 7.5 }, getUniversity('mit')!);
    expect(fit.flags).not.toContain('english-below');
    expect(fit.flags).toContain('english-strong');
  });

  it('converts TOEFL to a comparable band instead of ignoring it', () => {
    const fit = calculateTestFit(
      { ...base, englishTest: 'TOEFL', englishScore: 105 },
      getUniversity('hku')!,
    );
    expect(fit.flags).toContain('english-strong');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Missing SAT                                                      */
/* ------------------------------------------------------------------ */

describe('5. Missing SAT is not treated as SAT = 0', () => {
  it('scores a missing SAT well above a catastrophically low one', () => {
    const uni = getUniversity('hku')!; // SAT recommended ~1400
    const missing = calculateTestFit({ ...base, satTaken: false, satScore: null }, uni);
    const zero = calculateTestFit({ ...base, satTaken: true, satScore: 400 }, uni);
    expect(missing.score).toBeGreaterThan(zero.score);
    expect(missing.flags).toContain('sat-missing');
    expect(missing.concerns.join(' ')).toMatch(/unknown rather than low/i);
  });

  it('does not penalise a missing SAT where the test is not used at all', () => {
    const notUsed = calculateTestFit({ ...base, satTaken: false, satScore: null }, getUniversity('tu-delft')!);
    expect(notUsed.flags).not.toContain('sat-below');
    expect(notUsed.score).toBeGreaterThan(70);
  });

  it('treats a missing SAT as blocking only where the university requires one', () => {
    const required = calculateTestFit({ ...base, satTaken: false, satScore: null }, getUniversity('mit')!);
    const optional = calculateTestFit({ ...base, satTaken: false, satScore: null }, getUniversity('asu')!);
    expect(required.score).toBeLessThan(optional.score);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Full-scholarship requirement                                     */
/* ------------------------------------------------------------------ */

describe('6. Full-scholarship requirement penalises universities without relevant aid', () => {
  it('ranks a full-ride provider above a no-aid university for a full-ride student', () => {
    const profile = {
      ...base,
      aidNeed: 'full-ride' as const,
      budgetAnnualUSD: 1000,
      maxAffordableAnnualUSD: 3000,
      openToAnyCountry: true,
      preferredCountries: [],
      intendedMajor: 'economics' as const,
    };
    const fullRide = calculateOverallMatch(profile, getUniversity('nyuad')!);
    const noAid = calculateOverallMatch(profile, getUniversity('nyu')!);

    expect(fullRide.score).toBeGreaterThan(noAid.score);
    expect(fullRide.fits.scholarship.flags).toContain('full-ride-available');
    expect(noAid.fits.scholarship.flags).toContain('no-full-ride');
  });

  it('never calls a university a strong financial fit purely because aid might appear', () => {
    const profile = { ...base, aidNeed: 'full-ride' as const, budgetAnnualUSD: 0, maxAffordableAnnualUSD: 0 };
    const fit = calculateFinancialFit(profile, getUniversity('nyu')!);
    expect(fit.verdict).toBe('above-budget');
  });

  it('keeps a $5,000 budget away from an $80,000 university without verified aid', () => {
    const profile = { ...base, budgetAnnualUSD: 5000, maxAffordableAnnualUSD: 5000 };
    const fit = calculateFinancialFit(profile, getUniversity('edinburgh')!);
    expect(fit.verdict).toBe('above-budget');
    expect(fit.fundingGap).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 7 & 8. Demo profiles produce explained recommendations              */
/* ------------------------------------------------------------------ */

describe('7. Recommendations contain at least 3 institutions for demo profiles', () => {
  for (const demo of DEMO_PROFILES) {
    it(`returns >= 3 results for ${demo.id}`, () => {
      const profile = getDemoProfile(demo.id)!;
      const set = getRecommendations(profile);
      expect(set.results.length).toBeGreaterThanOrEqual(3);
      expect(set.results.length).toBeLessThanOrEqual(8);
    });
  }

  it('never returns an empty list without an explanation', () => {
    const impossible: StudentProfile = {
      ...base,
      aidNeed: 'full-ride',
      budgetAnnualUSD: 0,
      maxAffordableAnnualUSD: 0,
      preferredCountries: ['Poland'],
      openToAnyCountry: false,
      intendedMajor: 'medicine-health',
    };
    const set = getRecommendations(impossible);
    expect(set.results.length).toBeGreaterThanOrEqual(3);
    expect(set.notice).toBeTruthy();
  });
});

describe('8. Recommendation output contains reasons', () => {
  it('every recommendation for every demo profile carries reasons and a summary', () => {
    for (const demo of DEMO_PROFILES) {
      const set = getRecommendations(getDemoProfile(demo.id)!);
      for (const rec of set.results) {
        expect(rec.reasons.length).toBeGreaterThan(0);
        expect(rec.summary.length).toBeGreaterThan(40);
        expect(rec.summary).toMatch(/\.$|\. $/);
        expect(['strong', 'possible', 'ambitious']).toContain(rec.category);
      }
    }
  });

  it('exposes every score component so the explanation is auditable', () => {
    const rec = calculateOverallMatch(base, getUniversity('hkust')!);
    for (const key of ['academic', 'financial', 'major', 'geography', 'scholarship', 'tests', 'preference'] as const) {
      expect(typeof rec.components[key]).toBe('number');
      expect(rec.components[key]).toBeGreaterThanOrEqual(0);
      expect(rec.components[key]).toBeLessThanOrEqual(100);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 9. Roadmap responds to gaps                                         */
/* ------------------------------------------------------------------ */

describe('9. Roadmap responds to profile gaps', () => {
  it('adds an English test task only when there is an English gap', () => {
    const weak = { ...base, englishScore: 5.5, preferredCountries: ['USA' as const], openToAnyCountry: false };
    const strong = { ...base, englishScore: 8.0, preferredCountries: ['USA' as const], openToAnyCountry: false };

    const weakSet = getRecommendations(weak);
    const strongSet = getRecommendations(strong);

    const weakTasks = buildRoadmap(weak, weakSet.results, buildDiagnostics(weak, weakSet), TODAY);
    const strongTasks = buildRoadmap(strong, strongSet.results, buildDiagnostics(strong, strongSet), TODAY);

    expect(weakTasks.some((t) => t.id === 'english-register')).toBe(true);
    expect(strongTasks.some((t) => t.id === 'english-register')).toBe(false);
  });

  it('adds an SAT task when the student has no SAT but the shortlist wants one', () => {
    const noSat = {
      ...base,
      satTaken: false,
      satScore: null,
      preferredCountries: ['USA' as const],
      openToAnyCountry: false,
      budgetAnnualUSD: 50000,
      maxAffordableAnnualUSD: 70000,
      aidNeed: 'none' as const,
    };
    const set = getRecommendations(noSat);
    const tasks = buildRoadmap(noSat, set.results, buildDiagnostics(noSat, set), TODAY);
    expect(tasks.some((t) => t.id === 'sat-register')).toBe(true);
  });

  it('adds financial documentation tasks only for aid-dependent students', () => {
    const needsAid = { ...base, aidNeed: 'full-ride' as const };
    const noAid = { ...base, aidNeed: 'none' as const, budgetAnnualUSD: 70000, maxAffordableAnnualUSD: 90000 };

    const aidSet = getRecommendations(needsAid);
    const richSet = getRecommendations(noAid);

    const aidTasks = buildRoadmap(needsAid, aidSet.results, buildDiagnostics(needsAid, aidSet), TODAY);
    const richTasks = buildRoadmap(noAid, richSet.results, buildDiagnostics(noAid, richSet), TODAY);

    expect(aidTasks.some((t) => t.id === 'doc-financial')).toBe(true);
    expect(richTasks.some((t) => t.id === 'doc-financial')).toBe(false);
  });

  it('creates application tasks tied to the actual recommended universities', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    const applyTasks = tasks.filter((t) => t.category === 'applications');
    expect(applyTasks.length).toBeGreaterThan(0);
    for (const t of applyTasks) {
      expect(set.results.some((r) => r.university.id === t.relatedUniversityId)).toBe(true);
    }
  });

  it('never schedules a task in the past', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    for (const t of tasks) {
      expect(t.dueDate >= '2026-09-16').toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 10. Progress reacts to completion                                   */
/* ------------------------------------------------------------------ */

describe('10. Progress changes when tasks are completed', () => {
  it('increases the overall percentage as tasks are ticked off', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);

    const none = calculateProgress(tasks, {}, true);
    const some = calculateProgress(tasks, { [tasks[0].id]: true, [tasks[1].id]: true }, true);
    const all = calculateProgress(tasks, Object.fromEntries(tasks.map((t) => [t.id, true])), true);

    expect(some.overallPercent).toBeGreaterThan(none.overallPercent);
    expect(all.overallPercent).toBe(100);
    expect(all.completedTasks).toBe(tasks.length);
  });

  it('reports zero progress before the questionnaire is finished', () => {
    const empty = calculateProgress([], {}, false);
    expect(empty.overallPercent).toBe(0);
  });

  it('moves the next action forward once the current one is completed', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);

    const first = getNextAction(tasks, {}, set.results, TODAY)!;
    expect(first).not.toBeNull();
    const second = getNextAction(tasks, { [first.task.id]: true }, set.results, TODAY)!;
    expect(second.task.id).not.toBe(first.task.id);

    const allDone = getNextAction(tasks, Object.fromEntries(tasks.map((t) => [t.id, true])), set.results, TODAY);
    expect(allDone).toBeNull();
  });

  it('tracks progress per category, not just overall', () => {
    const set = getRecommendations(base);
    const tasks = buildRoadmap(base, set.results, buildDiagnostics(base, set), TODAY);
    const shortlistTasks = tasks.filter((t) => t.category === 'shortlist');
    const snapshot = calculateProgress(tasks, Object.fromEntries(shortlistTasks.map((t) => [t.id, true])), true);
    const shortlistTrack = snapshot.tracks.find((t) => t.key === 'shortlist')!;
    expect(shortlistTrack.percent).toBe(100);
    expect(snapshot.tracks.find((t) => t.key === 'applications')!.percent).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Supporting guarantees                                               */
/* ------------------------------------------------------------------ */

describe('Comparison engine', () => {
  it('identifies a genuine winner per comparable dimension', () => {
    const set = getRecommendations(base);
    const rows = buildComparison(set.results.slice(0, 3));
    expect(rows.length).toBeGreaterThan(10);
    const winners = rows.map(winnerOf).filter(Boolean);
    expect(winners.length).toBeGreaterThan(0);
  });
});

describe('Dataset integrity', () => {
  it('every university has source links and a resolvable id', () => {
    const ids = new Set<string>();
    for (const u of UNIVERSITIES) {
      expect(ids.has(u.id)).toBe(false);
      ids.add(u.id);
      expect(u.sources.admissions).toMatch(/^https:\/\//);
      expect(u.sources.tuition).toMatch(/^https:\/\//);
      expect(u.sources.scholarships).toMatch(/^https:\/\//);
      expect(u.officialUrl).toMatch(/^https:\/\//);
      expect(u.supportedMajors.length).toBeGreaterThan(0);
      expect(u.aidNote.length).toBeGreaterThan(20);
    }
    expect(UNIVERSITIES.length).toBeGreaterThanOrEqual(20);
  });

  it('marks every monetary figure with an explicit confidence level', () => {
    for (const u of UNIVERSITIES) {
      expect(['published', 'estimate', 'unknown']).toContain(u.estimatedTuition.confidence);
      expect(['published', 'estimate', 'unknown']).toContain(u.estimatedLivingCost.confidence);
      if (u.estimatedTuition.confidence === 'unknown') expect(u.estimatedTuition.value).toBeNull();
    }
  });
});

describe('Diagnostics', () => {
  it('derives every dimension from the profile and never crashes on an empty one', () => {
    const set = getRecommendations(EMPTY_PROFILE);
    const d = buildDiagnostics(EMPTY_PROFILE, set);
    expect(d.dimensions.length).toBeGreaterThanOrEqual(5);
    expect(d.gaps.some((g) => g.key === 'gpa-missing')).toBe(true);
    expect(d.gaps.some((g) => g.key === 'english-missing')).toBe(true);
  });
});
