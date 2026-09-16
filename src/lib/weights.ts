import type { ScoreComponents } from './types';

/**
 * Scoring configuration.
 *
 * Kept in one place so the weighting can be tuned (and reasoned about by judges)
 * without touching engine logic. Weights sum to 1.
 */
export const MATCH_WEIGHTS: ScoreComponents = {
  academic: 0.18,
  financial: 0.24,
  major: 0.18,
  geography: 0.13,
  scholarship: 0.10,
  tests: 0.08,
  preference: 0.09,
};

/**
 * Applied to universities outside the student's explicitly chosen countries.
 *
 * This is what makes the COUNTRY what-if control visibly change the result set
 * rather than just nudging the order: an out-of-scope university keeps its
 * intrinsic fit but is pushed below every comparable in-scope option.
 */
export const OUT_OF_SCOPE_MULTIPLIER = 0.55;

/** Score thresholds for the neutral match categories shown in the UI. */
export const CATEGORY_THRESHOLDS = {
  strong: 74,
  possible: 58,
};

/**
 * Minimum academic component required for a "Strong Match" label. Prevents a
 * cheap, nearby university from being called a strong match for a student whose
 * academic record is far below its typical intake.
 */
export const STRONG_MATCH_MIN_ACADEMIC = 55;

/** How many recommendations to surface by default. */
export const DEFAULT_RESULT_COUNT = 8;

/** Never show fewer than this, even when the filters are harsh. */
export const MIN_RESULT_COUNT = 3;

/**
 * Fraction of the sticker cost a student can plausibly still owe at the most
 * favourable realistic aid outcome, by published scholarship availability.
 *
 * These are deliberately conservative. We would rather tell a student that a
 * university is a stretch than send them to an application they cannot fund.
 */
export const BEST_CASE_NET_COST_FACTOR: Record<string, number> = {
  extensive: 0.25,
  moderate: 0.6,
  limited: 0.85,
  'rare-for-international': 0.95,
  unknown: 0.9,
};
