/**
 * Validation.
 *
 * Every rule here exists to stop a specific way of being confidently wrong. The
 * pipeline's bias is explicit: a candidate that trips any error becomes
 * REVIEW_REQUIRED or is rejected outright. An unverified value is a good
 * outcome; a plausible wrong one is not.
 */

const err = (field, message) => ({ field, severity: 'error', message });
const warn = (field, message) => ({ field, severity: 'warning', message });

/** Plausible annual tuition ceiling across every currency we handle. */
const MAX_ANNUAL_TUITION_USD = 120_000;

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export function validateMoneyCandidate(field, c) {
  const issues = [];
  if (c == null || c.value == null) return [err(field, 'no value extracted')];

  if (!Number.isFinite(c.value)) issues.push(err(field, `value is not finite: ${c.value}`));
  if (c.value < 0) issues.push(err(field, `negative amount: ${c.value}`));
  if (!c.currency) issues.push(err(field, 'currency could not be determined; a bare number is not usable'));

  // The per-unit trap. A monthly housing figure read as annual understates cost
  // of attendance roughly twelvefold and looks entirely plausible in the UI.
  if (c.unit === 'per-credit' || c.unit === 'per-month' || c.unit === 'per-week') {
    issues.push(err(field, `figure is quoted ${c.unit}, not annually; it cannot be used as an annual amount`));
  }
  if (c.unit === 'per-semester' || c.unit === 'per-quarter') {
    issues.push(warn(field, `figure is ${c.unit}; annualising requires knowing the number of terms, so this needs review`));
  }
  if (c.unit === 'unqualified') {
    issues.push(warn(field, 'the page does not state that this figure is annual; confirm before approving'));
  }

  if (c.currency === 'USD' && c.value > MAX_ANNUAL_TUITION_USD) {
    issues.push(err(field, `${c.value} USD exceeds the plausible annual ceiling; likely a multi-year or programme total`));
  }
  if (c.currency === 'USD' && c.value > 0 && c.value < 100 && c.unit !== 'per-credit') {
    issues.push(warn(field, `${c.value} USD is implausibly small for an annual figure`));
  }
  if (!c.academicYear) {
    issues.push(warn(field, 'no academic year attached; cost figures are cycle-specific'));
  }
  if (c.academicYearAmbiguous) {
    issues.push(err(field, `the page lists several academic years (${(c.academicYearCandidates ?? []).join(', ')}); cannot attribute this figure to one`));
  }
  return issues;
}

/* ------------------------------------------------------------------ */
/* English proficiency                                                 */
/* ------------------------------------------------------------------ */

export function validateIELTS(candidates) {
  const issues = [];
  if (!candidates || candidates.length === 0) return { value: null, issues: [warn('minimumIELTS', 'no IELTS score found')] };

  const overall = candidates.filter((c) => c.kind === 'overall');
  const unqualified = candidates.filter((c) => c.kind === 'unqualified');
  const pool = overall.length ? overall : unqualified;

  if (overall.length === 0 && unqualified.length === 0) {
    return {
      value: null,
      issues: [err('minimumIELTS', 'only per-section minimums found; the overall requirement is what the engine compares against')],
    };
  }

  const scores = [...new Set(pool.map((c) => c.score))];
  if (scores.length > 1) {
    issues.push(err('minimumIELTS', `conflicting overall minimums on the same page (${scores.join(', ')}); requires review`));
    return { value: null, issues };
  }

  const value = scores[0];
  if (value < 4 || value > 9) issues.push(err('minimumIELTS', `${value} is outside the IELTS scale`));
  if (Math.round(value * 2) !== value * 2) issues.push(err('minimumIELTS', `${value} is not a valid half-band`));
  if (overall.length === 0) issues.push(warn('minimumIELTS', 'the page does not say "overall"; confirm this is not a section minimum'));

  return { value: issues.some((i) => i.severity === 'error') ? null : value, issues };
}

export function validateTOEFL(candidates) {
  if (!candidates || candidates.length === 0) return { value: null, issues: [warn('minimumTOEFL', 'no TOEFL score found')] };
  const scores = [...new Set(candidates.map((c) => c.score))];
  if (scores.length > 1) {
    return { value: null, issues: [err('minimumTOEFL', `conflicting TOEFL minimums (${scores.join(', ')})`)] };
  }
  const value = scores[0];
  if (value < 30 || value > 120) return { value: null, issues: [err('minimumTOEFL', `${value} is outside the iBT scale`)] };
  return { value, issues: [] };
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export function validateDeadline(field, candidates, cycle = { from: '2026-08-01', to: '2027-12-31' }) {
  if (!candidates || candidates.length === 0) return { value: null, issues: [warn(field, 'no date found')] };

  const wanted = field === 'scholarshipDeadline' ? 'scholarship' : 'application';
  const typed = candidates.filter((c) => c.kind === wanted);
  const pool = typed.length ? typed : candidates.filter((c) => c.kind !== 'unqualified');

  if (pool.length === 0) {
    return { value: null, issues: [err(field, 'dates found but none is labelled as a deadline; a bare date is not a deadline')] };
  }

  const inCycle = pool.filter((c) => c.date >= cycle.from && c.date <= cycle.to);
  if (inCycle.length === 0) {
    return {
      value: null,
      issues: [err(field, `every candidate date falls outside the current cycle (${cycle.from}..${cycle.to}); the page is probably stale`)],
    };
  }

  const distinct = [...new Set(inCycle.map((c) => c.date))];
  if (distinct.length > 1) {
    return { value: null, issues: [err(field, `several in-cycle deadlines found (${distinct.join(', ')}); pick one in review`)] };
  }
  return { value: distinct[0], issues: [] };
}

/* ------------------------------------------------------------------ */
/* Aid policy                                                          */
/* ------------------------------------------------------------------ */

/**
 * Turns aid signals into the flags the financial matcher consumes.
 *
 * The conservative direction is deliberate and matches the engine's existing
 * AidCertainty model: unless a page explicitly extends aid to international
 * students, we do not record it as available to them.
 */
export function deriveAidFlags(signals) {
  const issues = [];

  if (signals.internationalExcluded.found) {
    return {
      flags: {
        needBasedAidForInternationals: false,
        meetsFullNeedForInternationals: false,
        fullTuitionPossible: false,
        fullRidePossible: false,
        aidCertainty: 'minimal',
      },
      issues: [warn('aid', 'the page states this aid is not open to international students')],
    };
  }

  const intlStated = signals.internationalEligible.found;
  if (!intlStated) {
    issues.push(
      err('aid', 'the page does not explicitly state that international students are eligible; aid availability cannot be inferred from generic wording'),
    );
  }

  // "Meets demonstrated need" must be stated, never inferred from vague aid text.
  const meetsFullNeed = signals.meetsFullNeed.found && intlStated;
  // A full ride requires living costs to be named, not just tuition.
  const fullRide = signals.fullRide.found && intlStated;
  // Full tuition is implied by a full ride, otherwise it must be stated.
  const fullTuition = (signals.fullTuition.found || fullRide) && intlStated;

  if (signals.anyScholarship.found && !signals.fullTuition.found && !signals.fullRide.found) {
    issues.push(warn('aid', 'scholarships are mentioned but neither full tuition nor full cost is claimed; recorded as partial only'));
  }
  if (signals.fullTuition.found && !signals.fullRide.found) {
    issues.push(warn('aid', 'full tuition is claimed but living costs are not; these are different things and are recorded separately'));
  }

  const aidCertainty = meetsFullNeed
    ? 'meets-full-need'
    : fullRide || fullTuition
      ? 'competitive'
      : signals.meritExists.found || signals.anyScholarship.found
        ? 'competitive'
        : 'minimal';

  return {
    flags: {
      needBasedAidForInternationals: intlStated && (signals.meetsFullNeed.found || signals.needBlind.found),
      meetsFullNeedForInternationals: meetsFullNeed,
      fullTuitionPossible: fullTuition,
      fullRidePossible: fullRide,
      aidCertainty,
    },
    issues,
  };
}

/* ------------------------------------------------------------------ */
/* Cross-field consistency                                             */
/* ------------------------------------------------------------------ */

/** Invariants that must hold across a whole candidate record. */
export function validateRecordConsistency(rec) {
  const issues = [];

  if (rec.fullRidePossible === true && rec.fullTuitionPossible === false) {
    issues.push(err('fullTuitionPossible', 'a full ride necessarily covers tuition, so full tuition cannot be false'));
  }
  if (rec.meetsFullNeedForInternationals === true && rec.needBasedAidForInternationals === false) {
    issues.push(err('needBasedAidForInternationals', 'meeting full demonstrated need is need-based aid'));
  }
  if (rec.aidCertainty === 'meets-full-need' && rec.meetsFullNeedForInternationals !== true) {
    issues.push(err('aidCertainty', 'meets-full-need certainty requires an explicit institutional commitment'));
  }
  if (rec.aidCertainty === 'minimal' && rec.fullRidePossible === true) {
    issues.push(err('aidCertainty', 'a full ride contradicts minimal published aid'));
  }

  if (rec.tuition != null && rec.totalCostOfAttendance != null && rec.totalCostOfAttendance < rec.tuition) {
    issues.push(err('totalCostOfAttendance', `total cost (${rec.totalCostOfAttendance}) is below tuition (${rec.tuition})`));
  }
  if (rec.minimumIELTS != null && rec.recommendedIELTS != null && rec.minimumIELTS > rec.recommendedIELTS) {
    issues.push(err('minimumIELTS', 'minimum exceeds the recommended threshold'));
  }
  if (rec.satPolicy === 'not-used' && (rec.minimumSAT != null || rec.recommendedSAT != null)) {
    issues.push(warn('satPolicy', 'a test-blind policy should not carry SAT thresholds'));
  }

  return issues;
}

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

export const VERDICT = {
  ACCEPT: 'ACCEPT',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  REJECT: 'REJECT',
};

/**
 * Decides what happens to a candidate.
 *
 * Confidence alone can never produce ACCEPT — a high-confidence extraction from
 * an unqualified page is exactly the failure this pipeline is built to prevent.
 * Evidence and a clean validation run are both required.
 */
export function verdictFor({ issues, hasEvidence, confidence = 0 }) {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) return { verdict: VERDICT.REJECT, errors, reason: errors[0].message };
  if (!hasEvidence) return { verdict: VERDICT.REJECT, errors, reason: 'no source evidence attached' };

  const warnings = issues.filter((i) => i.severity === 'warning');
  if (warnings.length > 0 || confidence < 0.9) {
    return {
      verdict: VERDICT.REVIEW_REQUIRED,
      errors,
      reason: warnings.length ? warnings[0].message : `confidence ${confidence} below the automatic threshold`,
    };
  }
  return { verdict: VERDICT.ACCEPT, errors, reason: 'passed validation with evidence' };
}
