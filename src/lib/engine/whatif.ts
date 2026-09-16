import type { Recommendation, StudentProfile } from '../types';
import type { RecommendationSet } from './score';
import { formatUSD } from './utils';

export interface ChangeEffect {
  direction: 'up' | 'down' | 'neutral';
  text: string;
}

export interface WhatChanged {
  headline: string;
  effects: ChangeEffect[];
  entered: Recommendation[];
  left: Recommendation[];
  /** True when nothing meaningful moved — the UI says so rather than faking drama. */
  noChange: boolean;
}

/**
 * Explains, in plain language, what a change to budget or country did to the
 * result set. This is the feature the case specifically calls out: the student
 * must SEE that the product responds to their parameters.
 */
export function diffRecommendations(
  before: { profile: StudentProfile; set: RecommendationSet },
  after: { profile: StudentProfile; set: RecommendationSet },
): WhatChanged {
  const beforeIds = new Set(before.set.results.map((r) => r.university.id));
  const afterIds = new Set(after.set.results.map((r) => r.university.id));

  const entered = after.set.results.filter((r) => !beforeIds.has(r.university.id));
  const left = before.set.results.filter((r) => !afterIds.has(r.university.id));

  const effects: ChangeEffect[] = [];
  const headlines: string[] = [];

  /* ---- Budget ---- */
  const b0 = before.profile.maxAffordableAnnualUSD;
  const b1 = after.profile.maxAffordableAnnualUSD;
  if (b0 !== b1) {
    headlines.push(`Your budget changed from ${formatUSD(b0)}/year to ${formatUSD(b1)}/year.`);
  }

  /* ---- Countries ---- */
  const c0 = before.profile.openToAnyCountry ? ['Open to any'] : before.profile.preferredCountries;
  const c1 = after.profile.openToAnyCountry ? ['Open to any'] : after.profile.preferredCountries;
  if (c0.join(',') !== c1.join(',')) {
    headlines.push(
      `Your destination changed from ${c0.length ? c0.join(' + ') : 'nothing selected'} to ${c1.length ? c1.join(' + ') : 'nothing selected'}.`,
    );
  }

  /* ---- Aid need ---- */
  if (before.profile.aidNeed !== after.profile.aidNeed) {
    headlines.push(
      `Your funding requirement changed from ${before.profile.aidNeed.replace('-', ' ')} to ${after.profile.aidNeed.replace('-', ' ')}.`,
    );
  }

  /* ---- Effects ---- */
  const affordableDelta = after.set.affordableWithoutAidCount - before.set.affordableWithoutAidCount;
  if (affordableDelta !== 0) {
    effects.push({
      direction: affordableDelta > 0 ? 'up' : 'down',
      text: `${affordableDelta > 0 ? '+' : '−'}${Math.abs(affordableDelta)} universit${Math.abs(affordableDelta) === 1 ? 'y is' : 'ies are'} now financially compatible without depending on aid`,
    });
  }

  const aidDelta = after.set.aidDependentCount - before.set.aidDependentCount;
  if (aidDelta !== 0) {
    effects.push({
      direction: aidDelta > 0 ? 'up' : 'down',
      text: `${aidDelta > 0 ? '+' : '−'}${Math.abs(aidDelta)} universit${Math.abs(aidDelta) === 1 ? 'y' : 'ies'} reachable only with a scholarship`,
    });
  }

  const overDelta = after.set.aboveBudgetCount - before.set.aboveBudgetCount;
  if (overDelta !== 0) {
    effects.push({
      direction: overDelta > 0 ? 'down' : 'up',
      text: `${overDelta > 0 ? '+' : '−'}${Math.abs(overDelta)} universit${Math.abs(overDelta) === 1 ? 'y' : 'ies'} above your budget even in the best aid scenario`,
    });
  }

  if (entered.length > 0) {
    effects.push({
      direction: 'up',
      text: `${entered.length} new option${entered.length === 1 ? '' : 's'} entered your results: ${entered
        .slice(0, 4)
        .map((r) => r.university.shortName)
        .join(', ')}${entered.length > 4 ? `, +${entered.length - 4} more` : ''}`,
    });
  }
  if (left.length > 0) {
    effects.push({
      direction: 'down',
      text: `${left.length} option${left.length === 1 ? '' : 's'} dropped out: ${left
        .slice(0, 4)
        .map((r) => r.university.shortName)
        .join(', ')}${left.length > 4 ? `, +${left.length - 4} more` : ''}`,
    });
  }

  /* Top-of-list change is the most visible signal of all. */
  const topBefore = before.set.results[0]?.university.shortName;
  const topAfter = after.set.results[0]?.university.shortName;
  if (topBefore && topAfter && topBefore !== topAfter) {
    effects.push({ direction: 'neutral', text: `Your top match changed from ${topBefore} to ${topAfter}` });
  }

  /* Scholarship dependence across the visible list. */
  const depBefore = before.set.results.filter(
    (r) => r.fits.financial.verdict === 'potentially-affordable-with-aid',
  ).length;
  const depAfter = after.set.results.filter(
    (r) => r.fits.financial.verdict === 'potentially-affordable-with-aid',
  ).length;
  if (depAfter !== depBefore) {
    effects.push({
      direction: depAfter < depBefore ? 'up' : 'down',
      text: `Scholarship dependence across your shortlist ${depAfter < depBefore ? 'decreased' : 'increased'} (${depBefore} → ${depAfter} of ${after.set.results.length} need aid to work)`,
    });
  }

  return {
    headline: headlines.join(' ') || 'Your parameters changed.',
    effects,
    entered,
    left,
    noChange: effects.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* What-if control helpers                                             */
/* ------------------------------------------------------------------ */

export interface BudgetOption {
  label: string;
  /** Annual USD the family can pay. `null` means no strict limit. */
  value: number;
  aidNeed: StudentProfile['aidNeed'];
  hint: string;
}

/**
 * The budget presets offered by the what-if control.
 *
 * Each preset carries the funding requirement it logically implies: a family that
 * can pay $25,000 a year does not need a full ride, and pretending otherwise
 * would make the simulation dishonest. The UI states this explicitly when the
 * requirement changes, so the student always sees both halves of the change.
 */
export const BUDGET_OPTIONS: BudgetOption[] = [
  { label: '$0', value: 0, aidNeed: 'full-ride', hint: 'Full cost must be covered by the university' },
  { label: '$5,000', value: 5000, aidNeed: 'full-ride', hint: 'Tuition and most living costs must be covered' },
  { label: '$10,000', value: 10000, aidNeed: 'full-tuition', hint: 'You can cover living costs, tuition must be covered' },
  { label: '$25,000', value: 25000, aidNeed: 'partial', hint: 'Partial scholarships make the shortlist workable' },
  { label: 'No strict limit', value: 120000, aidNeed: 'none', hint: 'Cost is not the binding constraint' },
];

/** Applies a budget preset, keeping the profile internally consistent. */
export function applyBudgetOption(profile: StudentProfile, option: BudgetOption): StudentProfile {
  return {
    ...profile,
    budgetAnnualUSD: option.value,
    maxAffordableAnnualUSD: option.value,
    aidNeed: option.aidNeed,
  };
}

/** Finds the preset closest to a profile's current ceiling, for initial control state. */
export function nearestBudgetOption(profile: StudentProfile): BudgetOption {
  const target = Math.max(profile.maxAffordableAnnualUSD, profile.budgetAnnualUSD);
  return BUDGET_OPTIONS.reduce((best, opt) =>
    Math.abs(opt.value - target) < Math.abs(best.value - target) ? opt : best,
  );
}
