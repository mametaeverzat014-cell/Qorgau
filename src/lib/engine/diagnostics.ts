import type {
  DiagnosticDimension,
  Diagnostics,
  ProfileGap,
  StudentProfile,
} from '../types';
import type { RecommendationSet } from './score';
import { studentIeltsEquivalent } from './matchers';
import { formatUSD, normalizeGpa } from './utils';

/**
 * Builds the diagnostic screen shown BEFORE any university list.
 *
 * Every dimension and every insight is derived from the student's own answers
 * plus the ranked result set. We never assert certainty we do not have.
 */
export function buildDiagnostics(profile: StudentProfile, set: RecommendationSet): Diagnostics {
  const dimensions: DiagnosticDimension[] = [];
  const insights: string[] = [];
  const gaps: ProfileGap[] = [];

  /* ---------------- Academics ---------------- */
  const gpa = normalizeGpa(profile.gpaValue, profile.gpaScale);
  if (gpa === null) {
    dimensions.push({
      key: 'academics',
      label: 'Academics',
      level: 'unknown',
      value: 40,
      detail: 'No academic average provided, so we could not assess your academic standing.',
    });
    gaps.push({
      key: 'gpa-missing',
      title: 'Academic average missing',
      detail: 'Add your GPA or school average so recommendations can account for academic fit.',
      severity: 'medium',
    });
  } else {
    const level = gpa >= 92 ? 'strong' : gpa >= 84 ? 'competitive' : gpa >= 75 ? 'moderate' : 'needs-improvement';
    dimensions.push({
      key: 'academics',
      label: 'Academics',
      level,
      value: Math.round(gpa),
      detail: `Your average normalises to ${Math.round(gpa)}% on a 100-point scale${
        profile.classRank !== 'unknown' && profile.classRank !== 'other'
          ? `, and you reported being in the ${profile.classRank.replace('top-', 'top ')}% of your class`
          : ''
      }.`,
    });
  }

  /* ---------------- English ---------------- */
  const ielts = studentIeltsEquivalent(profile);
  if (ielts === null) {
    dimensions.push({
      key: 'english',
      label: 'English',
      level: 'needs-improvement',
      value: 25,
      detail: profile.englishPlanned
        ? 'You plan to take an English test but have no score yet. Most universities in your list require one before the deadline.'
        : 'No English test score on file. Nearly every university in this dataset requires proof of English.',
    });
    gaps.push({
      key: 'english-missing',
      title: 'No English test score yet',
      detail:
        'An IELTS or TOEFL score is a hard requirement at almost every university in your results. Book a test date before your earliest deadline.',
      severity: 'high',
    });
  } else {
    const level = ielts >= 7.0 ? 'ready' : ielts >= 6.5 ? 'ready' : ielts >= 6.0 ? 'moderate' : 'needs-improvement';
    const shortfalls = set.results.filter((r) => r.fits.tests.flags.includes('english-below'));
    dimensions.push({
      key: 'english',
      label: 'English',
      level,
      value: Math.round((ielts / 9) * 100),
      detail:
        shortfalls.length === 0
          ? `IELTS ${ielts} equivalent meets the published requirement at every university currently in your results.`
          : `IELTS ${ielts} equivalent falls below the requirement at ${shortfalls.length} of your ${set.results.length} recommendations.`,
    });
    if (shortfalls.length > 0) {
      const highest = Math.max(
        ...shortfalls.map((r) => r.university.minimumIELTS ?? r.university.recommendedIELTS ?? 6.5),
      );
      gaps.push({
        key: 'english-below',
        title: `English requirement gap at ${shortfalls.length} recommended universit${shortfalls.length === 1 ? 'y' : 'ies'}`,
        detail: `You currently sit at IELTS ${ielts}. Reaching ${highest} would clear the requirement across your whole shortlist.`,
        severity: 'high',
      });
    }
  }

  /* ---------------- Standardised testing ---------------- */
  const satNeeded = set.results.filter(
    (r) => r.university.satPolicy === 'required' || r.university.satPolicy === 'recommended',
  );
  if (profile.satScore === null) {
    dimensions.push({
      key: 'testing',
      label: 'Standardized Testing',
      level: satNeeded.length > 0 ? 'needs-improvement' : 'moderate',
      value: 30,
      detail:
        satNeeded.length > 0
          ? `Not taken. ${satNeeded.length} of your recommendations require or recommend an SAT/ACT score. We score this as unknown, never as zero.`
          : 'Not taken — and none of your current recommendations require it, so this is not blocking you.',
    });
    if (satNeeded.length > 0) {
      gaps.push({
        key: 'sat-missing',
        title: 'No SAT/ACT score',
        detail: `${satNeeded.map((r) => r.university.shortName).slice(0, 3).join(', ')} require or recommend a standardised test score. Registering for a sitting would open these up.`,
        severity: satNeeded.some((r) => r.university.satPolicy === 'required') ? 'high' : 'medium',
      });
    }
  } else {
    const below = set.results.filter((r) => r.fits.tests.flags.includes('sat-below'));
    dimensions.push({
      key: 'testing',
      label: 'Standardized Testing',
      level: below.length === 0 ? 'strong' : below.length <= 2 ? 'competitive' : 'needs-improvement',
      value: Math.min(100, Math.round(((profile.satScore - 800) / 800) * 100)),
      detail:
        below.length === 0
          ? `SAT ${profile.satScore} is at or above the typical range of every recommendation in your list.`
          : `SAT ${profile.satScore} is below the typical range at ${below.length} of your recommendations.`,
    });
    if (below.length >= 2) {
      const target = Math.max(...below.map((r) => r.university.recommendedSAT ?? 0));
      gaps.push({
        key: 'sat-below',
        title: 'A higher SAT would widen your range',
        detail: `Moving from ${profile.satScore} towards ${target} would put you in range at ${below.length} more of your current recommendations.`,
        severity: 'medium',
      });
    }
  }

  /* ---------------- Financial flexibility ---------------- */
  const ceiling = Math.max(profile.maxAffordableAnnualUSD, profile.budgetAnnualUSD);
  const finLevel =
    ceiling >= 45000 ? 'strong' : ceiling >= 22000 ? 'moderate' : ceiling >= 8000 ? 'limited' : 'limited';
  dimensions.push({
    key: 'financial',
    label: 'Financial Flexibility',
    level: finLevel,
    value: Math.min(100, Math.round((ceiling / 60000) * 100)),
    detail: `You can contribute up to ${formatUSD(profile.budgetAnnualUSD)} comfortably, with an absolute ceiling of ${formatUSD(ceiling)} per year. ${set.affordableWithoutAidCount} of ${set.all.length} universities in our dataset fall inside that without aid.`,
  });

  /* ---------------- Scholarship dependence ---------------- */
  const depLevel =
    profile.aidNeed === 'full-ride'
      ? 'very-high'
      : profile.aidNeed === 'full-tuition'
        ? 'very-high'
        : profile.aidNeed === 'partial'
          ? 'moderate'
          : 'limited';
  dimensions.push({
    key: 'scholarship',
    label: 'Scholarship Dependence',
    level: depLevel,
    value:
      profile.aidNeed === 'full-ride' ? 100 : profile.aidNeed === 'full-tuition' ? 80 : profile.aidNeed === 'partial' ? 50 : 15,
    detail: {
      'full-ride': 'You need tuition and living costs covered. Only a minority of universities worldwide offer this to international undergraduates — the engine weights that heavily.',
      'full-tuition': 'You need tuition covered in full and can fund living costs yourself.',
      partial: 'Partial scholarships would make your target list workable.',
      none: 'You are not dependent on scholarships, which keeps your options broad.',
    }[profile.aidNeed],
  });
  if (profile.aidNeed === 'full-ride' || profile.aidNeed === 'full-tuition') {
    gaps.push({
      key: 'scholarship-dependence',
      title: 'Your plan depends on winning aid',
      detail: `${set.results.filter((r) => r.fits.financial.verdict === 'potentially-affordable-with-aid').length} of your recommendations only work if the scholarship comes through. Apply to at least one option you could fund without aid.`,
      severity: 'high',
    });
  }

  /* ---------------- Target selectivity ---------------- */
  const selective = set.results.filter((r) => r.university.admissionSelectivity === 'highly-selective').length;
  const ratio = set.results.length ? selective / set.results.length : 0;
  dimensions.push({
    key: 'selectivity',
    label: 'Target Selectivity',
    level: ratio >= 0.6 ? 'very-high' : ratio >= 0.3 ? 'competitive' : 'moderate',
    value: Math.round(ratio * 100),
    detail: `${selective} of your ${set.results.length} recommendations are highly selective. A balanced list mixes ambitious options with places where your profile is comfortably in range.`,
  });

  /* ---------------- Insights ---------------- */
  if (gpa !== null && gpa >= 88 && ceiling < 15000) {
    insights.push(
      'You have a strong academic profile, but your financial requirements significantly narrow the universities that are realistically affordable — your best route is institutions that publish full-cost aid for international students, not simply cheaper universities.',
    );
  }
  if (ielts !== null && ielts >= 6.5) {
    insights.push(
      `Your current English score satisfies the published requirement at ${set.results.filter((r) => r.fits.tests.flags.includes('english-met') || r.fits.tests.flags.includes('english-strong')).length} of your ${set.results.length} recommendations.`,
    );
  }
  if (profile.satScore === null && satNeeded.length >= 2) {
    insights.push(
      `A standardised test score would expand your competitive range: ${satNeeded.length} of your current recommendations ask for one, and we are scoring that as unknown rather than penalising you for a zero.`,
    );
  }
  if (profile.satScore !== null && profile.satScore < 1450) {
    insights.push(
      `A higher SAT score could expand your competitive range — the highly selective universities in your list typically admit students above ${Math.max(1450, profile.satScore + 60)}.`,
    );
  }
  if (set.aboveBudgetCount > set.all.length / 2) {
    insights.push(
      `${set.aboveBudgetCount} of the ${set.all.length} universities we track are out of reach at your stated budget even in the best aid scenario. Raising your ceiling, or targeting need-based institutions, is the single biggest lever you have.`,
    );
  }
  if (!profile.openToAnyCountry && profile.preferredCountries.length === 1) {
    insights.push(
      `You selected a single destination (${profile.preferredCountries[0]}). Adding one more country typically changes the top of your list substantially — try the country control on the recommendations screen.`,
    );
    gaps.push({
      key: 'narrow-geography',
      title: 'Single-country plan',
      detail: 'Applying in only one country concentrates your risk. Consider adding a second destination as a backup.',
      severity: 'low',
    });
  }
  if (set.notice) insights.push(set.notice);

  return { dimensions, insights: insights.slice(0, 5), gaps };
}
