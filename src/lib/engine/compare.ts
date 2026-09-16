import type { Recommendation } from '../types';
import { mainAdvantage, mainConcern } from './explain';
import { formatUSD } from './utils';

export interface CompareRow {
  key: string;
  label: string;
  /** Raw comparable value per university, used to highlight the best option. */
  values: { id: string; display: string; numeric: number | null; note?: string }[];
  /** 'high' = higher numeric wins, 'low' = lower wins, null = not comparable. */
  better: 'high' | 'low' | null;
}

const FINANCIAL_LABEL: Record<string, string> = {
  'strong-financial-fit': 'Strong financial fit',
  'potentially-affordable-with-aid': 'Affordable only with aid',
  'above-budget': 'Above budget',
  unknown: 'Unknown',
};

const FINANCIAL_RANK: Record<string, number> = {
  'strong-financial-fit': 3,
  'potentially-affordable-with-aid': 2,
  unknown: 1,
  'above-budget': 0,
};

const dateDisplay = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Not published';

/**
 * Builds the comparison table.
 *
 * It deliberately does more than repeat the cards: each row knows which direction
 * is better, so the UI can mark the winning cell and the student can make a real
 * decision instead of reading the same facts twice.
 */
export function buildComparison(recs: Recommendation[]): CompareRow[] {
  const rows: CompareRow[] = [];
  const map = <T>(fn: (r: Recommendation) => T) => recs.map((r) => ({ r, v: fn(r) }));

  rows.push({
    key: 'country',
    label: 'Country / City',
    better: null,
    values: map((r) => `${r.university.country} — ${r.university.city}`).map(({ r, v }) => ({
      id: r.university.id,
      display: v,
      numeric: null,
    })),
  });

  rows.push({
    key: 'match',
    label: 'Match score',
    better: 'high',
    values: recs.map((r) => ({ id: r.university.id, display: `${r.score}%`, numeric: r.score })),
  });

  rows.push({
    key: 'program',
    label: 'Programme for your major',
    better: 'high',
    values: recs.map((r) => ({
      id: r.university.id,
      display:
        r.fits.major.score >= 90
          ? r.university.programs[0] ?? 'Available'
          : r.fits.major.score >= 50
            ? 'Related programme only'
            : 'Not offered',
      numeric: r.fits.major.score,
    })),
  });

  rows.push({
    key: 'tuition',
    label: 'Estimated tuition / year',
    better: 'low',
    values: recs.map((r) => ({
      id: r.university.id,
      display: formatUSD(r.university.estimatedTuition.value),
      numeric: r.university.estimatedTuition.value,
      note: r.university.estimatedTuition.note,
    })),
  });

  rows.push({
    key: 'living',
    label: 'Estimated living cost / year',
    better: 'low',
    values: recs.map((r) => ({
      id: r.university.id,
      display: formatUSD(r.university.estimatedLivingCost.value),
      numeric: r.university.estimatedLivingCost.value,
    })),
  });

  rows.push({
    key: 'netcost',
    label: 'Best-case cost to you / year',
    better: 'low',
    values: recs.map((r) => ({
      id: r.university.id,
      display: formatUSD(r.fits.financial.bestCaseNetCost),
      numeric: r.fits.financial.bestCaseNetCost,
      note: 'After the most favourable realistic aid outcome',
    })),
  });

  rows.push({
    key: 'financial',
    label: 'Affordability verdict',
    better: 'high',
    values: recs.map((r) => ({
      id: r.university.id,
      display: FINANCIAL_LABEL[r.fits.financial.verdict],
      numeric: FINANCIAL_RANK[r.fits.financial.verdict],
    })),
  });

  rows.push({
    key: 'scholarship',
    label: 'Scholarship availability',
    better: 'high',
    values: recs.map((r) => ({
      id: r.university.id,
      display: r.university.fullRidePossible
        ? 'Full cost possible'
        : r.university.fullTuitionPossible
          ? 'Full tuition possible'
          : r.university.scholarshipAvailability === 'extensive'
            ? 'Extensive partial aid'
            : r.university.scholarshipAvailability === 'moderate'
              ? 'Moderate partial aid'
              : 'Limited',
      numeric: r.components.scholarship,
    })),
  });

  rows.push({
    key: 'ielts',
    label: 'English requirement',
    better: 'low',
    values: recs.map((r) => ({
      id: r.university.id,
      display:
        r.university.minimumIELTS !== null
          ? `IELTS ${r.university.minimumIELTS}`
          : r.university.recommendedIELTS !== null
            ? `IELTS ~${r.university.recommendedIELTS} (recommended)`
            : 'Not published',
      numeric: r.university.minimumIELTS ?? r.university.recommendedIELTS,
    })),
  });

  rows.push({
    key: 'sat',
    label: 'SAT policy',
    better: null,
    values: recs.map((r) => ({
      id: r.university.id,
      display:
        r.university.satPolicy === 'not-used'
          ? 'Not used'
          : `${r.university.satPolicy.charAt(0).toUpperCase()}${r.university.satPolicy.slice(1)}${
              r.university.recommendedSAT ? ` (~${r.university.recommendedSAT})` : ''
            }`,
      numeric: null,
    })),
  });

  rows.push({
    key: 'selectivity',
    label: 'Admission selectivity',
    better: null,
    values: recs.map((r) => ({
      id: r.university.id,
      display: r.university.admissionSelectivity.replace('-', ' '),
      numeric: null,
      note: r.university.selectivityNote,
    })),
  });

  rows.push({
    key: 'deadline',
    label: 'Application deadline',
    better: null,
    values: recs.map((r) => ({
      id: r.university.id,
      display: dateDisplay(r.university.applicationDeadline),
      numeric: null,
    })),
  });

  rows.push({
    key: 'scholarship-deadline',
    label: 'Scholarship deadline',
    better: null,
    values: recs.map((r) => ({
      id: r.university.id,
      display: dateDisplay(r.university.scholarshipDeadline),
      numeric: null,
    })),
  });

  rows.push({
    key: 'advantage',
    label: 'Main advantage for you',
    better: null,
    values: recs.map((r) => ({ id: r.university.id, display: mainAdvantage(r), numeric: null })),
  });

  rows.push({
    key: 'concern',
    label: 'Main concern for you',
    better: null,
    values: recs.map((r) => ({ id: r.university.id, display: mainConcern(r), numeric: null })),
  });

  return rows;
}

/** Which university id wins a given row, or null when the row is not comparable. */
export function winnerOf(row: CompareRow): string | null {
  if (!row.better) return null;
  const withValues = row.values.filter((v) => v.numeric !== null) as {
    id: string;
    numeric: number;
  }[];
  if (withValues.length < 2) return null;
  const sorted = [...withValues].sort((a, b) =>
    row.better === 'high' ? b.numeric - a.numeric : a.numeric - b.numeric,
  );
  // No winner when everything ties.
  if (sorted[0].numeric === sorted[sorted.length - 1].numeric) return null;
  return sorted[0].id;
}

/** One sentence per university explaining what it uniquely wins on. */
export function comparisonTakeaways(recs: Recommendation[]): { id: string; text: string }[] {
  const rows = buildComparison(recs);
  return recs.map((r) => {
    const wins = rows.filter((row) => winnerOf(row) === r.university.id).map((row) => row.label.toLowerCase());
    if (wins.length === 0) {
      return {
        id: r.university.id,
        text: `${r.university.shortName} does not lead on any single dimension here — it is the balanced option rather than the best at anything specific.`,
      };
    }
    return {
      id: r.university.id,
      text: `${r.university.shortName} is the best of these on ${wins.slice(0, 3).join(', ')}.`,
    };
  });
}
