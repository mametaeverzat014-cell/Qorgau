import type {
  FinancialFitResult,
  FitResult,
  StudentProfile,
  University,
} from '../types';
import { MAJOR_CLUSTERS, MAJOR_LABELS } from '../types';
import { BEST_CASE_NET_COST_FACTOR } from '../weights';
import {
  clamp,
  duolingoToIelts,
  formatUSD,
  labelFor,
  normalizeGpa,
  scale,
  toeflToIelts,
} from './utils';

const empty = (): { reasons: string[]; concerns: string[]; flags: string[] } => ({
  reasons: [],
  concerns: [],
  flags: [],
});

/* ------------------------------------------------------------------ */
/* Academic fit                                                        */
/* ------------------------------------------------------------------ */

const SELECTIVITY_PRESSURE: Record<University['admissionSelectivity'], number> = {
  'highly-selective': 10,
  selective: 5,
  moderate: 0,
  accessible: -4,
};

/**
 * Compares the student's normalised academic average with the university's
 * typical competitive intake, adjusted for how selective the institution is.
 *
 * This is explicitly an ALIGNMENT measure. It never claims to predict admission.
 */
export function calculateAcademicFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  const gpa = normalizeGpa(profile.gpaValue, profile.gpaScale);

  if (gpa === null) {
    flags.push('gpa-missing');
    concerns.push('We could not assess academic fit because no academic average was provided.');
    return { score: 50, label: 'unknown', reasons, concerns, flags };
  }

  const bar = uni.gpaExpectation + SELECTIVITY_PRESSURE[uni.admissionSelectivity];
  const delta = gpa - bar;

  // -15 points below the bar -> 20; at the bar -> 78; +8 above -> 100.
  let score = delta >= 0 ? scale(delta, 0, 8, 78, 100) : scale(delta, -20, 0, 15, 78);

  if (profile.classRank === 'top-1' || profile.classRank === 'top-5') {
    score = clamp(score + 6);
    reasons.push(`Your class rank (${profile.classRank === 'top-1' ? 'top 1%' : 'top 5%'}) strengthens an already competitive academic record.`);
  }

  if (delta >= 4) {
    reasons.push(
      `Your academic average (${Math.round(gpa)}%) is above the profile this university typically admits (~${uni.gpaExpectation}%).`,
    );
  } else if (delta >= -3) {
    reasons.push(
      `Your academic average (${Math.round(gpa)}%) is in line with this university's typical intake (~${uni.gpaExpectation}%).`,
    );
  } else {
    flags.push('academic-gap');
    concerns.push(
      `Your academic average (${Math.round(gpa)}%) sits below the ~${uni.gpaExpectation}% typical of admitted students here.`,
    );
  }

  if (uni.admissionSelectivity === 'highly-selective') {
    flags.push('highly-selective');
    concerns.push(`Admission is highly selective. ${uni.selectivityNote}`);
  }

  return { score: Math.round(score), label: labelFor(score), reasons, concerns, flags };
}

/* ------------------------------------------------------------------ */
/* Financial fit                                                       */
/* ------------------------------------------------------------------ */

/**
 * The most consequential matcher. It answers a question students actually ask:
 * "with what my family can pay, and the aid this university realistically gives
 * international students, can I go here?"
 *
 * Deliberately conservative: a university is only "Strong Financial Fit" when the
 * sticker cost is already within reach, and only "Potentially Affordable With Aid"
 * when the institution publishes aid capable of bridging the gap.
 */
export function calculateFinancialFit(profile: StudentProfile, uni: University): FinancialFitResult {
  const { reasons, concerns, flags } = empty();
  const tuition = uni.estimatedTuition.value;
  const living = uni.estimatedLivingCost.value;

  if (tuition === null || living === null) {
    return {
      score: 50,
      label: 'unknown',
      verdict: 'unknown',
      totalAnnualCost: null,
      bestCaseNetCost: null,
      fundingGap: null,
      aidCertainty: uni.aidCertainty,
      reasons,
      concerns: ['Cost data for this university could not be verified, so affordability is unknown.'],
      flags: ['cost-unknown'],
    };
  }

  const totalAnnualCost = tuition + living;
  const budget = profile.budgetAnnualUSD;
  const ceiling = Math.max(profile.maxAffordableAnnualUSD, budget);

  // Best realistic out-of-pocket cost after the aid this institution actually offers.
  let bestCaseNetCost: number;
  if (uni.fullRidePossible) {
    bestCaseNetCost = 0;
  } else if (uni.fullTuitionPossible) {
    bestCaseNetCost = living;
  } else {
    const factor = BEST_CASE_NET_COST_FACTOR[uni.scholarshipAvailability] ?? 0.9;
    bestCaseNetCost = Math.round(totalAnnualCost * factor);
  }
  // Aid can never make a place cost more than its sticker price.
  bestCaseNetCost = Math.min(bestCaseNetCost, totalAnnualCost);

  const fundingGap = Math.max(0, bestCaseNetCost - ceiling);

  let score: number;
  let verdict: FinancialFitResult['verdict'];

  // How dependable the aid is. An institution that meets the full demonstrated
  // need of everyone it admits is a different proposition from one that awards a
  // handful of competitive scholarships, even when the headline figure matches.
  const dependable = uni.aidCertainty === 'meets-full-need' || uni.aidCertainty === 'structural';

  if (totalAnnualCost <= budget) {
    verdict = 'strong-financial-fit';
    score = 100;
    reasons.push(
      `Estimated total annual cost of ${formatUSD(totalAnnualCost)} is within your stated budget of ${formatUSD(budget)} — no scholarship is strictly required.`,
    );
    flags.push('affordable-without-aid');
  } else if (totalAnnualCost <= ceiling) {
    verdict = 'strong-financial-fit';
    score = Math.round(scale(totalAnnualCost, ceiling, budget, 78, 96));
    reasons.push(
      `Estimated total annual cost of ${formatUSD(totalAnnualCost)} fits under your maximum affordable cost of ${formatUSD(ceiling)}.`,
    );
    concerns.push('It sits above your comfortable annual budget, so partial aid would still help.');
    flags.push('affordable-at-ceiling');
  } else if (bestCaseNetCost <= ceiling) {
    // The gap can close on paper. Whether it closes in practice depends entirely
    // on how this institution funds international undergraduates.
    const reliance = (totalAnnualCost - ceiling) / totalAnnualCost; // 0..1

    if (dependable) {
      verdict = 'potentially-affordable-with-aid';
      score = Math.round(clamp(58 + (1 - reliance) * 22));
      reasons.push(
        uni.aidCertainty === 'meets-full-need'
          ? `Sticker cost is ${formatUSD(totalAnnualCost)} a year, but ${uni.shortName} states it meets the full demonstrated need of admitted international students — so the figure that matters to you is closer to ${formatUSD(bestCaseNetCost)}.`
          : `Cost here is low by default rather than by competition: ${formatUSD(bestCaseNetCost)} a year is the normal outcome for admitted students, not a prize you have to win.`,
      );
      concerns.push(
        'Funding still depends on being admitted and on your documented family finances. Treat it as conditional until you hold an offer.',
      );
      flags.push('aid-dependent', 'aid-dependable');
    } else {
      verdict = 'aid-dependent';
      // Deliberately capped below the dependable case: this is a contest, and
      // telling a student otherwise is the most damaging thing this engine could do.
      const reliability = uni.aidCertainty === 'competitive' ? 1 : 0.5;
      score = Math.round(clamp(30 + (1 - reliance) * 14 + reliability * 8));
      reasons.push(
        `Sticker cost is ${formatUSD(totalAnnualCost)} a year. Awards here can reach ${formatUSD(bestCaseNetCost)}, which would bring it inside your ceiling of ${formatUSD(ceiling)}.`,
      );
      concerns.push(
        uni.aidCertainty === 'competitive'
          ? 'That funding is a competitive award, not a need-based guarantee — a limited number are granted each year. This route only works if you win one, so do not build your plan on it alone.'
          : 'This university publishes little aid for international undergraduates, so reaching that figure is unlikely. Treat it as a long shot.',
      );
      flags.push('aid-dependent', 'aid-competitive');
    }
  } else {
    verdict = 'above-budget';
    // How far beyond reach — the further, the lower.
    score = Math.round(scale(fundingGap, 0, Math.max(totalAnnualCost, 1), 34, 2));
    concerns.push(
      `Even in the best realistic aid scenario the cost here is around ${formatUSD(bestCaseNetCost)} per year, roughly ${formatUSD(fundingGap)} above what you said you can pay.`,
    );
    flags.push('above-budget');
  }

  if (uni.estimatedTuition.confidence === 'estimated' || uni.estimatedLivingCost.confidence === 'estimated') {
    flags.push('cost-estimated');
  }

  return {
    score,
    label: labelFor(score),
    verdict,
    totalAnnualCost,
    bestCaseNetCost,
    fundingGap: fundingGap || 0,
    aidCertainty: uni.aidCertainty,
    reasons,
    concerns,
    flags,
  };
}

/* ------------------------------------------------------------------ */
/* Scholarship fit                                                     */
/* ------------------------------------------------------------------ */

/**
 * Separate from financial fit on purpose. Financial fit asks "can the numbers
 * work?"; scholarship fit asks "does this university offer the KIND of support
 * this student said they need?".
 */
export function calculateScholarshipFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  const availability = uni.scholarshipAvailability;

  let score: number;

  if (profile.aidNeed === 'none') {
    score = 80;
    reasons.push('You are not dependent on scholarships, so aid availability does not constrain this option.');
    return { score, label: labelFor(score), reasons, concerns, flags };
  }

  if (profile.aidNeed === 'full-ride') {
    if (uni.fullRidePossible) {
      score = 96;
      reasons.push(`Full-cost support is genuinely possible here: ${uni.aidNote.split('.')[0]}.`);
      flags.push('full-ride-available');
    } else if (uni.fullTuitionPossible) {
      score = 58;
      concerns.push(
        'Tuition can be covered in full, but living costs would still need funding from another source.',
      );
      flags.push('living-costs-uncovered');
    } else {
      score = 14;
      concerns.push(
        'You require full-cost funding, and this university does not publish aid capable of covering tuition and living costs for international students.',
      );
      flags.push('no-full-ride');
    }
  } else if (profile.aidNeed === 'full-tuition') {
    if (uni.fullRidePossible || uni.fullTuitionPossible) {
      score = 90;
      reasons.push('Full-tuition support is available to international students here.');
      flags.push('full-tuition-available');
    } else {
      score = 26;
      concerns.push('Full-tuition scholarships are not published for international undergraduates here.');
      flags.push('no-full-tuition');
    }
  } else {
    // partial
    const base: Record<University['scholarshipAvailability'], number> = {
      extensive: 94,
      moderate: 78,
      limited: 50,
      'rare-for-international': 30,
      unknown: 45,
    };
    score = base[availability];
    if (score >= 78) {
      reasons.push('Partial scholarships for international students are well established here.');
    } else {
      concerns.push('Scholarship volume for international undergraduates is limited — plan for a larger family contribution.');
      flags.push('thin-scholarships');
    }
  }

  if (uni.needBasedAidForInternationals) {
    reasons.push('Need-based aid is explicitly available to international students, not only merit awards.');
  }

  return { score, label: labelFor(score), reasons, concerns, flags };
}

/* ------------------------------------------------------------------ */
/* Major fit                                                           */
/* ------------------------------------------------------------------ */

function areAdjacent(a: string, b: string): boolean {
  return MAJOR_CLUSTERS.some((cluster) => cluster.includes(a as never) && cluster.includes(b as never));
}

export function calculateMajorFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  const target = profile.intendedMajor;
  const label = MAJOR_LABELS[target];

  if (uni.supportedMajors.includes(target)) {
    const named = uni.programs.slice(0, 2).join(', ');
    reasons.push(`${label} is offered here${named ? ` (e.g. ${named})` : ''}.`);
    flags.push('major-available');
    return { score: 100, label: 'excellent', reasons, concerns, flags };
  }

  const adjacent = uni.supportedMajors.some((m) => areAdjacent(target, m));
  if (adjacent) {
    const closest = uni.supportedMajors.find((m) => areAdjacent(target, m))!;
    concerns.push(
      `${label} is not a listed programme here, but the closely related ${MAJOR_LABELS[closest]} is — you would need to check whether the curriculum covers what you want.`,
    );
    flags.push('major-adjacent');
    return { score: 62, label: 'moderate', reasons, concerns, flags };
  }

  concerns.push(`${label} does not appear in this university's programme list in our dataset.`);
  flags.push('major-missing');
  return { score: 18, label: 'weak', reasons, concerns, flags };
}

/* ------------------------------------------------------------------ */
/* Geography fit                                                       */
/* ------------------------------------------------------------------ */

export function calculateGeographicFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  let score: number;

  const wantsSpecific = !profile.openToAnyCountry && profile.preferredCountries.length > 0;

  if (!wantsSpecific) {
    score = 78;
    reasons.push('You are open to any location, so geography does not restrict this option.');
  } else if (profile.preferredCountries.includes(uni.country)) {
    score = 100;
    reasons.push(`${uni.country} is one of your preferred destinations.`);
    flags.push('preferred-country');
  } else if (profile.preferredCountries.some((c) => countryRegion(c) === uni.region)) {
    score = 58;
    concerns.push(`${uni.country} is not on your list, though it is in a region you selected (${uni.region}).`);
    flags.push('preferred-region-only');
  } else {
    score = 20;
    concerns.push(`${uni.country} is outside the countries you selected.`);
    flags.push('outside-preferred');
  }

  // City environment is a secondary signal, worth a few points either way.
  if (profile.citySizePreference !== 'no-preference') {
    if (profile.citySizePreference === uni.citySize) {
      score = clamp(score + 8);
      reasons.push(`The setting matches your preference for a ${uni.citySize.replace('-', ' ')}.`);
    } else {
      score = clamp(score - 5);
    }
  }
  if (profile.environmentPreference !== 'no-preference' && profile.environmentPreference === uni.environment) {
    score = clamp(score + 5);
  }

  if (profile.englishTaughtOnly && !uni.languagesOfInstruction.includes('English')) {
    score = clamp(score - 35);
    concerns.push('Instruction here is not primarily in English, which you said you require.');
    flags.push('language-mismatch');
  }

  return { score: Math.round(score), label: labelFor(score), reasons, concerns, flags };
}

function countryRegion(country: string): string {
  // Small local lookup so the matcher stays a pure function without a data import cycle.
  const map: Record<string, string> = {
    USA: 'North America',
    'South Korea': 'East Asia',
    'Hong Kong': 'East Asia',
    Japan: 'East Asia',
    Singapore: 'Southeast Asia',
    Germany: 'Europe',
    Netherlands: 'Europe',
    Italy: 'Europe',
    Austria: 'Europe',
    Czechia: 'Europe',
    Poland: 'Europe',
    'United Kingdom': 'Europe',
    France: 'Europe',
    UAE: 'Middle East',
    Kazakhstan: 'Central Asia',
  };
  return map[country] ?? 'Unknown';
}

/* ------------------------------------------------------------------ */
/* Test / requirement fit                                              */
/* ------------------------------------------------------------------ */

/** Converts whatever English test the student took into a comparable IELTS band. */
export function studentIeltsEquivalent(profile: StudentProfile): number | null {
  if (profile.englishScore === null || profile.englishTest === 'none') return null;
  switch (profile.englishTest) {
    case 'IELTS':
      return profile.englishScore;
    case 'TOEFL':
      return toeflToIelts(profile.englishScore);
    case 'Duolingo':
      return duolingoToIelts(profile.englishScore);
    default:
      return null;
  }
}

/**
 * English and standardised testing.
 *
 * Two rules matter here and both are explicit requirements of the case:
 *   1. An English score below the published minimum raises a warning.
 *   2. A missing SAT is NOT treated as SAT = 0. It is treated as unknown, and
 *      only penalised where the university actually requires or recommends one.
 */
export function calculateTestFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  const parts: number[] = [];

  /* --- English --- */
  const ielts = studentIeltsEquivalent(profile);
  const requirement = uni.minimumIELTS ?? uni.recommendedIELTS;

  if (ielts === null) {
    flags.push('english-missing');
    if (profile.englishPlanned) {
      concerns.push(
        `You have not taken an English test yet. ${uni.shortName} expects around IELTS ${requirement ?? 6.5}.`,
      );
    } else {
      concerns.push(
        `No English test on file. ${uni.shortName} requires proof of English at roughly IELTS ${requirement ?? 6.5}.`,
      );
    }
    parts.push(45);
  } else if (requirement === null) {
    reasons.push(`Your English (IELTS ${ielts} equivalent) should be acceptable here.`);
    parts.push(80);
  } else if (ielts >= requirement + 0.5) {
    reasons.push(`Your English score (IELTS ${ielts} equivalent) is comfortably above the ${requirement} expected here.`);
    flags.push('english-strong');
    parts.push(100);
  } else if (ielts >= requirement) {
    reasons.push(`Your English score (IELTS ${ielts} equivalent) meets the ${requirement} requirement.`);
    flags.push('english-met');
    parts.push(88);
  } else {
    const gap = Math.round((requirement - ielts) * 10) / 10;
    flags.push('english-below');
    concerns.push(
      `English requirement gap: ${uni.shortName} expects IELTS ${requirement} and your current level is ${ielts} — ${gap} band${gap === 0.5 ? '' : 's'} short.`,
    );
    parts.push(clamp(scale(requirement - ielts, 2, 0, 10, 62)));
  }

  /* --- SAT / ACT --- */
  const satTarget = uni.recommendedSAT ?? uni.minimumSAT;

  if (uni.satPolicy === 'not-used') {
    reasons.push('This admissions system does not use SAT/ACT, so testing is not a barrier here.');
    parts.push(92);
  } else if (profile.satScore !== null) {
    if (satTarget === null) {
      parts.push(80);
    } else if (profile.satScore >= satTarget) {
      reasons.push(`Your SAT (${profile.satScore}) is at or above the ~${satTarget} typical of admitted students.`);
      flags.push('sat-strong');
      parts.push(100);
    } else {
      const gap = satTarget - profile.satScore;
      flags.push('sat-below');
      concerns.push(
        `Your SAT (${profile.satScore}) is about ${gap} points below the ~${satTarget} typical here; a retake would widen your range.`,
      );
      parts.push(clamp(scale(gap, 250, 0, 25, 92)));
    }
  } else {
    // NOT TAKEN — never scored as zero.
    flags.push('sat-missing');
    if (uni.satPolicy === 'required') {
      concerns.push(`${uni.shortName} requires SAT or ACT and you have not taken one yet — this is a blocking gap.`);
      parts.push(30);
    } else if (uni.satPolicy === 'recommended') {
      concerns.push(
        `SAT is recommended here. You have not taken it, so this is scored as unknown rather than low — a score would strengthen the application.`,
      );
      parts.push(58);
    } else {
      reasons.push('SAT is optional here, so not having a score does not disadvantage you.');
      parts.push(85);
    }
  }

  const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  return { score, label: labelFor(score), reasons, concerns, flags };
}

/* ------------------------------------------------------------------ */
/* Preference fit                                                      */
/* ------------------------------------------------------------------ */

export function calculatePreferenceFit(profile: StudentProfile, uni: University): FitResult {
  const { reasons, concerns, flags } = empty();
  const p = profile.preferences;

  // Each sub-signal is an alignment 0-100, weighted by how much the student cares.
  const researchAlign = 100 - Math.abs(p.research - (uni.researchIntensity - 1) * 25);
  const prestigeAlign = 100 - Math.abs(p.prestige - (uni.prestigeTier - 1) * 25);

  const sizeAlign =
    profile.sizePreference === 'no-preference' ? 75 : profile.sizePreference === uni.size ? 100 : 45;

  const weights = [
    { v: clamp(researchAlign), w: Math.max(p.research, 20) },
    { v: clamp(prestigeAlign), w: Math.max(p.prestige, 20) },
    { v: sizeAlign, w: 40 },
  ];
  const totalW = weights.reduce((a, b) => a + b.w, 0);
  const score = Math.round(weights.reduce((a, b) => a + b.v * b.w, 0) / totalW);

  if (p.research >= 65 && uni.researchIntensity >= 4) {
    reasons.push('Matches your preference for a research-intensive environment.');
    flags.push('research-match');
  }
  if (p.research <= 35 && uni.researchIntensity <= 3) {
    reasons.push('Matches your preference for a practical, teaching-focused environment.');
  }
  if (p.prestige >= 70 && uni.prestigeTier >= 4) {
    reasons.push('Globally recognised name, which you said matters to you.');
  }
  if (p.prestige >= 70 && uni.prestigeTier <= 2) {
    concerns.push('Reputation here is more regional than global, which you weighted as important.');
  }
  if (profile.sizePreference !== 'no-preference' && profile.sizePreference !== uni.size) {
    concerns.push(`This is a ${uni.size} university and you preferred ${profile.sizePreference}.`);
  }

  return { score, label: labelFor(score), reasons, concerns, flags };
}
