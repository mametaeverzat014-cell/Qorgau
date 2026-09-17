import type { Recommendation, StudentProfile } from '../types';
import { MAJOR_LABELS } from '../types';
import { formatUSD } from './utils';

/**
 * Deterministic explanation engine.
 *
 * Produces the full-sentence "why this university" paragraph shown on cards and
 * detail pages. This runs with no network and no API key — the optional AI layer
 * only ever rephrases what this function already established.
 */
export function buildSummary(profile: StudentProfile, rec: Recommendation): string {
  const u = rec.university;
  const clauses: string[] = [];
  const major = MAJOR_LABELS[profile.intendedMajor];

  /* Opening clause — why it surfaced at all. */
  if (rec.fits.major.score >= 90) {
    clauses.push(`Recommended because it offers ${major}`);
  } else if (rec.fits.major.score >= 50) {
    clauses.push(`Recommended because it offers programmes adjacent to ${major}`);
  } else {
    clauses.push(`Surfaced despite not offering ${major} directly, because the rest of your profile aligns well`);
  }

  /* Financial clause — always present, because budget is the case's key lever. */
  const fin = rec.fits.financial;
  switch (fin.verdict) {
    case 'strong-financial-fit':
      clauses.push(
        `the estimated total cost of ${formatUSD(fin.totalAnnualCost)} a year sits inside what you said your family can pay`,
      );
      break;
    case 'potentially-affordable-with-aid':
      clauses.push(
        fin.aidCertainty === 'meets-full-need'
          ? `it states it meets the full demonstrated need of admitted international students, which brings a ${formatUSD(fin.totalAnnualCost)} sticker cost down to roughly ${formatUSD(fin.bestCaseNetCost)} a year for a family in your position`
          : `its cost is low by default rather than by competition, at roughly ${formatUSD(fin.bestCaseNetCost)} a year`,
      );
      break;
    case 'aid-dependent':
      clauses.push(
        `it could come down from ${formatUSD(fin.totalAnnualCost)} to about ${formatUSD(fin.bestCaseNetCost)} a year, but only by winning a competitive award rather than through guaranteed need-based support`,
      );
      break;
    case 'above-budget':
      clauses.push(
        `the realistic cost of about ${formatUSD(fin.bestCaseNetCost)} a year remains above your stated ceiling`,
      );
      break;
    default:
      clauses.push('its published cost data could not be verified, so affordability here is unconfirmed');
  }

  /* Geography clause. */
  if (rec.outsidePreferredCountries) {
    clauses.push(`it sits outside your chosen countries, in ${u.country}`);
  } else if (rec.fits.geography.flags.includes('preferred-country')) {
    clauses.push(`it is in ${u.country}, one of your preferred destinations`);
  } else if (profile.openToAnyCountry && rec.fits.geography.score >= 85) {
    clauses.push(`its setting in ${u.city} matches the environment you said you wanted`);
  }

  /* Preference clause. */
  if (profile.preferences.research >= 65 && u.researchIntensity >= 4) {
    clauses.push('and it matches your preference for a research-intensive university');
  } else if (profile.preferences.scholarship >= 70 && u.scholarshipAvailability === 'extensive') {
    clauses.push('and scholarship support is one of its stronger features, which you weighted heavily');
  }

  let text = `${clauses[0]}, ${clauses.slice(1).join(', ')}.`;
  text = text.replace(', and it matches', ' and it matches').replace(', and scholarship', ' and scholarship');

  /* Closing caveat — the single most important concern, stated plainly. */
  const topConcern = rec.concerns[0];
  if (topConcern) {
    text += ` However: ${topConcern.charAt(0).toLowerCase()}${topConcern.slice(1)}`;
  }

  return text;
}

/** Short one-line label used on compact cards. */
export function mainAdvantage(rec: Recommendation): string {
  const c = rec.components;
  const ranked: [string, number][] = [
    ['Financial fit', c.financial],
    ['Programme fit', c.major],
    ['Academic fit', c.academic],
    ['Scholarship support', c.scholarship],
    ['Location fit', c.geography],
    ['Entry requirements', c.tests],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

/** Short one-line label for the weakest dimension. */
export function mainConcern(rec: Recommendation): string {
  const c = rec.components;
  const ranked: [string, number][] = [
    ['Cost', c.financial],
    ['Programme availability', c.major],
    ['Academic profile gap', c.academic],
    ['Scholarship availability', c.scholarship],
    ['Location', c.geography],
    ['Test scores', c.tests],
  ];
  ranked.sort((a, b) => a[1] - b[1]);
  if (ranked[0][1] >= 78) return 'No major concern';
  return ranked[0][0];
}

export const CATEGORY_LABELS: Record<Recommendation['category'], string> = {
  strong: 'Strong Match',
  possible: 'Possible Match',
  ambitious: 'Ambitious Option',
};

export const CATEGORY_TOOLTIP =
  'Match level reflects alignment with your stated profile and preferences. It is not an admission probability.';
