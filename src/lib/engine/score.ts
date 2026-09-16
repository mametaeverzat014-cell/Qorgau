import { UNIVERSITIES } from '@/data/universities';
import type {
  MatchCategory,
  Recommendation,
  ScoreComponents,
  StudentProfile,
  University,
} from '../types';
import {
  CATEGORY_THRESHOLDS,
  DEFAULT_RESULT_COUNT,
  MATCH_WEIGHTS,
  MIN_RESULT_COUNT,
  OUT_OF_SCOPE_MULTIPLIER,
  STRONG_MATCH_MIN_ACADEMIC,
} from '../weights';
import { buildSummary } from './explain';
import {
  calculateAcademicFit,
  calculateFinancialFit,
  calculateGeographicFit,
  calculateMajorFit,
  calculatePreferenceFit,
  calculateScholarshipFit,
  calculateTestFit,
} from './matchers';
import { uniq } from './utils';

function categorize(score: number, components: ScoreComponents): MatchCategory {
  if (score >= CATEGORY_THRESHOLDS.strong && components.academic >= STRONG_MATCH_MIN_ACADEMIC) {
    return 'strong';
  }
  if (score >= CATEGORY_THRESHOLDS.possible) return 'possible';
  return 'ambitious';
}

/**
 * Scores a single university against a profile.
 *
 * Returns the weighted match score together with every component, every reason
 * and every concern, so the UI never has to invent an explanation.
 */
export function calculateOverallMatch(profile: StudentProfile, uni: University): Recommendation {
  const academic = calculateAcademicFit(profile, uni);
  const financial = calculateFinancialFit(profile, uni);
  const major = calculateMajorFit(profile, uni);
  const geography = calculateGeographicFit(profile, uni);
  const scholarship = calculateScholarshipFit(profile, uni);
  const tests = calculateTestFit(profile, uni);
  const preference = calculatePreferenceFit(profile, uni);

  const components: ScoreComponents = {
    academic: academic.score,
    financial: financial.score,
    major: major.score,
    geography: geography.score,
    scholarship: scholarship.score,
    tests: tests.score,
    preference: preference.score,
  };

  let score =
    components.academic * MATCH_WEIGHTS.academic +
    components.financial * MATCH_WEIGHTS.financial +
    components.major * MATCH_WEIGHTS.major +
    components.geography * MATCH_WEIGHTS.geography +
    components.scholarship * MATCH_WEIGHTS.scholarship +
    components.tests * MATCH_WEIGHTS.tests +
    components.preference * MATCH_WEIGHTS.preference;

  const wantsSpecific = !profile.openToAnyCountry && profile.preferredCountries.length > 0;
  const outsidePreferredCountries = wantsSpecific && !profile.preferredCountries.includes(uni.country);

  if (outsidePreferredCountries) {
    // Keeps the intrinsic fit visible but ranks it below every in-scope option.
    score *= OUT_OF_SCOPE_MULTIPLIER;
  }

  const rounded = Math.round(score);
  const reasons = uniq([
    ...major.reasons,
    ...financial.reasons,
    ...scholarship.reasons,
    ...geography.reasons,
    ...academic.reasons,
    ...tests.reasons,
    ...preference.reasons,
  ]);
  const concerns = uniq([
    ...financial.concerns,
    ...scholarship.concerns,
    ...tests.concerns,
    ...academic.concerns,
    ...major.concerns,
    ...geography.concerns,
    ...preference.concerns,
  ]);

  const recommendation: Recommendation = {
    university: uni,
    score: rounded,
    category: categorize(rounded, components),
    components,
    fits: { academic, financial, major, geography, scholarship, tests, preference },
    reasons,
    concerns,
    summary: '',
    outsidePreferredCountries,
  };

  recommendation.summary = buildSummary(profile, recommendation);
  return recommendation;
}

export interface RecommendationSet {
  results: Recommendation[];
  /** Everything scored, ranked — used by the comparison and what-if diff engines. */
  all: Recommendation[];
  /** How many universities are affordable without depending on aid. */
  affordableWithoutAidCount: number;
  /** How many are reachable only if aid comes through. */
  aidDependentCount: number;
  /** How many are out of reach even in the best realistic aid scenario. */
  aboveBudgetCount: number;
  /** True when we had to reach outside the chosen countries to fill the list. */
  relaxedGeography: boolean;
  /** Human-readable explanation when results are thin or empty. */
  notice: string | null;
}

/**
 * Ranks the full dataset for a profile.
 *
 * Never returns an empty list without an explanation: if the student's filters
 * exclude everything, we widen the search one step and say so explicitly.
 */
export function getRecommendations(
  profile: StudentProfile,
  limit = DEFAULT_RESULT_COUNT,
  pool: University[] = UNIVERSITIES,
): RecommendationSet {
  const all = pool
    .map((uni) => calculateOverallMatch(profile, uni))
    .sort((a, b) => b.score - a.score || a.university.name.localeCompare(b.university.name));

  const inScope = all.filter((r) => !r.outsidePreferredCountries);
  const viable = inScope.filter((r) => r.fits.financial.verdict !== 'above-budget');

  let results: Recommendation[];
  let notice: string | null = null;
  let relaxedGeography = false;

  if (viable.length >= MIN_RESULT_COUNT) {
    results = viable.slice(0, limit);
    // Backfill with in-scope stretch options so the list still reaches `limit`.
    if (results.length < limit) {
      const extra = inScope.filter((r) => !results.includes(r)).slice(0, limit - results.length);
      results = [...results, ...extra];
    }
  } else if (inScope.length >= MIN_RESULT_COUNT) {
    results = inScope.slice(0, limit);
    notice =
      'Few universities in your selected countries fit your budget and funding requirement. The options below include some where the cost would only work with substantial aid — check the financial notes on each one.';
  } else {
    relaxedGeography = true;
    results = all.slice(0, limit);
    const chosen = profile.preferredCountries.join(', ');
    notice = profile.openToAnyCountry
      ? 'Your budget and funding requirement are tight, so the list below includes options that depend on winning aid.'
      : `We could not find enough universities matching both your selected ${profile.preferredCountries.length === 1 ? 'country' : 'countries'} (${chosen}) and the rest of your profile. We widened the search beyond ${chosen} so you still have real options — try adding a country or raising your budget to get a tighter list.`;
  }

  return {
    results,
    all,
    affordableWithoutAidCount: all.filter((r) => r.fits.financial.verdict === 'strong-financial-fit').length,
    aidDependentCount: all.filter((r) => r.fits.financial.verdict === 'potentially-affordable-with-aid').length,
    aboveBudgetCount: all.filter((r) => r.fits.financial.verdict === 'above-budget').length,
    relaxedGeography,
    notice,
  };
}
