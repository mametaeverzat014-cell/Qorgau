import { describe, expect, it } from 'vitest';
import {
  assertValidVerifiedValue, curated, derive, evidenceCoverage, primaryEvidence,
  reconcile, unverified, validateEvidenceBag, verified,
  type SourceEvidence, type UniversityEvidence,
} from '@/lib/provenance';

// The pipeline is plain Node so it can run without the app toolchain.
import {
  detectAcademicYear, extractAidPolicy, extractCommonDataSet, extractDeadlines,
  extractIELTS, extractTestingPolicy, htmlToText, moneyNear,
} from '../scripts/university-data/extract.mjs';
import {
  deriveAidFlags, validateDeadline, validateIELTS, validateMoneyCandidate,
  validateRecordConsistency, verdictFor, VERDICT,
} from '../scripts/university-data/validate.mjs';
import { hostMatchesDomain, isAllowedUrl, looksLikeChallenge, assertSafeId } from '../scripts/university-data/safety.mjs';
import { rootDomainOf, readCuratedUniversities } from '../scripts/university-data/registry.mjs';

const ev = (over: Partial<SourceEvidence> = {}): SourceEvidence => ({
  url: 'https://registrar.mit.edu/tuition',
  retrievedAt: '2026-09-17T10:00:00.000Z',
  sourceType: 'official_web',
  ...over,
});

/* ================================================================== */
/* Evidence model                                                      */
/* ================================================================== */

describe('Verified values preserve evidence', () => {
  it('carries its source', () => {
    const v = verified(66720, [ev({ academicYear: '2026-27' })]);
    expect(v.status).toBe('verified');
    expect(v.evidence[0].url).toContain('mit.edu');
    expect(assertValidVerifiedValue('tuition', v)).toHaveLength(0);
  });

  it('refuses to construct a verified value without evidence', () => {
    // The whole point of the status. A 'verified' value with nothing behind it
    // is the failure this module exists to prevent.
    expect(() => verified(1, [])).toThrow(/requires at least one piece of source evidence/);
  });

  it('flags a verified status that lost its evidence', () => {
    const broken = { value: 1, status: 'verified' as const, evidence: [] };
    const issues = assertValidVerifiedValue('tuition', broken);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects non-https, unparseable dates and malformed academic years', () => {
    expect(
      assertValidVerifiedValue('t', { value: 1, status: 'verified', evidence: [ev({ url: 'http://mit.edu/x' })] })
        .some((i) => /not https/.test(i.message)),
    ).toBe(true);
    expect(
      assertValidVerifiedValue('t', { value: 1, status: 'verified', evidence: [ev({ retrievedAt: 'yesterday' })] })
        .some((i) => /valid date/.test(i.message)),
    ).toBe(true);
    expect(
      assertValidVerifiedValue('t', { value: 1, status: 'verified', evidence: [ev({ academicYear: '2026/2027' })] })
        .some((i) => /YYYY-YY/.test(i.message)),
    ).toBe(true);
  });
});

describe('Unverified values stay null', () => {
  it('constructs as null', () => {
    const u = unverified<number>('page did not state a figure');
    expect(u.value).toBeNull();
    expect(assertValidVerifiedValue('x', u)).toHaveLength(0);
  });

  it('is an error for an unverified value to carry a number', () => {
    const smuggled = { value: 42, status: 'unverified' as const, evidence: [] };
    expect(assertValidVerifiedValue('x', smuggled).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('Derived values preserve their dependencies', () => {
  it('records what it was computed from', () => {
    const tuition = verified(60000, [ev()]);
    const living = verified(20000, [ev({ url: 'https://registrar.mit.edu/living' })]);
    const total = derive(80000, [{ field: 'tuition', source: tuition }, { field: 'livingCost', source: living }]);
    expect(total.status).toBe('derived');
    expect(total.derivedFrom).toEqual(['tuition', 'livingCost']);
    expect(total.evidence).toHaveLength(2);
    expect(assertValidVerifiedValue('total', total)).toHaveLength(0);
  });

  it('cannot launder an unverified input into a verified total', () => {
    const tuition = verified(60000, [ev()]);
    const living = unverified<number>();
    const total = derive(80000, [{ field: 'tuition', source: tuition }, { field: 'livingCost', source: living }]);
    expect(total.status).toBe('unverified');
    expect(total.value).toBeNull();
  });

  it('inherits the weakest status rather than the strongest', () => {
    const total = derive(80000, [
      { field: 'a', source: verified(1, [ev()]) },
      { field: 'b', source: curated(2) },
    ]);
    expect(total.status).toBe('curated');
  });
});

describe('Source reconciliation', () => {
  it('prefers a Common Data Set over a web page', () => {
    const cds = verified(66720, [ev({ sourceType: 'common_data_set' })]);
    const web = verified(64310, [ev({ sourceType: 'official_web' })]);
    const r = reconcile(cds, web);
    expect(r.winner?.value).toBe(66720);
  });

  it('escalates to review when two equal sources disagree', () => {
    const a = verified(100, [ev({ sourceType: 'official_web', academicYear: '2026-27' })]);
    const b = verified(200, [ev({ sourceType: 'official_web', academicYear: '2026-27' })]);
    const r = reconcile(a, b);
    expect(r.winner).toBeNull();
    expect(r.reason).toMatch(/human review/);
  });

  it('prefers the newer academic year when source types tie', () => {
    const older = verified(100, [ev({ academicYear: '2023-24' })]);
    const newer = verified(120, [ev({ academicYear: '2026-27' })]);
    expect(reconcile(older, newer).winner?.value).toBe(120);
  });
});

describe('Evidence bag', () => {
  it('validates every populated field and measures coverage', () => {
    const bag: UniversityEvidence = {
      tuition: verified(60000, [ev()]),
      livingCost: curated(20000),
      minimumIELTS: unverified(),
    };
    expect(validateEvidenceBag(bag)).toHaveLength(0);
    const cov = evidenceCoverage(bag);
    expect(cov.verified).toBe(1);
    expect(cov.percent).toBeGreaterThan(0);
    expect(evidenceCoverage(undefined).percent).toBe(0);
  });

  it('picks the strongest evidence for display', () => {
    const v = verified(1, [ev({ sourceType: 'official_web' }), ev({ sourceType: 'common_data_set' })]);
    expect(primaryEvidence(v)?.sourceType).toBe('common_data_set');
  });
});

/* ================================================================== */
/* Security                                                            */
/* ================================================================== */

describe('Only approved official domains are fetchable', () => {
  it('accepts the institution and its subdomains', () => {
    expect(isAllowedUrl('https://mit.edu/x', ['mit.edu']).ok).toBe(true);
    expect(isAllowedUrl('https://registrar.mit.edu/x', ['mit.edu']).ok).toBe(true);
  });

  it('rejects an unrelated domain', () => {
    expect(isAllowedUrl('https://notmit.edu/x', ['mit.edu']).ok).toBe(false);
  });

  it('rejects suffix confusion', () => {
    // mit.edu.evil.com ends with "evil.com", not "mit.edu".
    expect(isAllowedUrl('https://mit.edu.evil.com/x', ['mit.edu']).ok).toBe(false);
    expect(hostMatchesDomain('mit.edu.evil.com', 'mit.edu')).toBe(false);
  });

  it('rejects non-https, credentials, and non-standard ports', () => {
    expect(isAllowedUrl('http://mit.edu/x', ['mit.edu']).ok).toBe(false);
    expect(isAllowedUrl('https://u:p@mit.edu/x', ['mit.edu']).ok).toBe(false);
    expect(isAllowedUrl('https://mit.edu:8080/x', ['mit.edu']).ok).toBe(false);
  });

  it('rejects internal hosts even if a bad registry entry allow-lists them', () => {
    for (const host of ['localhost', '127.0.0.1', '169.254.169.254', '10.0.0.1', 'foo.internal']) {
      expect(isAllowedUrl(`https://${host}/x`, [host]).ok, host).toBe(false);
    }
  });

  it('rejects ids that could escape the data directory', () => {
    for (const bad of ['../etc', 'a/b', 'A', '', 'x'.repeat(61)]) {
      expect(() => assertSafeId(bad), bad).toThrow();
    }
    expect(assertSafeId('tu-delft')).toBe('tu-delft');
  });

  it('detects a bot challenge wearing a legitimate domain', () => {
    expect(looksLikeChallenge('<html><body>Just a moment...<div id="cf-browser-verification"></div></body></html>')).toBe(true);
    expect(looksLikeChallenge('<html><body>Tuition and fees for 2026-27</body></html>')).toBe(false);
  });
});

/* ================================================================== */
/* Extraction                                                          */
/* ================================================================== */

describe('Money extraction refuses the per-unit trap', () => {
  it('flags a monthly housing figure instead of reading it as annual', () => {
    const m = moneyNear('On-campus housing costs $1,200 per month.', ['housing'])[0];
    expect(m.unit).toBe('per-month');
    expect(m.isAnnual).toBe(false);
    const issues = validateMoneyCandidate('livingCost', m);
    expect(issues.some((i) => i.severity === 'error' && /per-month/.test(i.message))).toBe(true);
  });

  it('accepts an explicitly annual figure', () => {
    const m = moneyNear('Tuition is $66,720 per year.', ['tuition'])[0];
    expect(m.isAnnual).toBe(true);
    expect(m.value).toBe(66720);
    expect(validateMoneyCandidate('tuition', { ...m, academicYear: '2026-27' })
      .filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects a bare number with no currency', () => {
    expect(validateMoneyCandidate('tuition', { value: 50000, currency: null, unit: 'per-year' })
      .some((i) => /currency/.test(i.message))).toBe(true);
  });

  it('rejects negative and implausibly large amounts', () => {
    expect(validateMoneyCandidate('tuition', { value: -5, currency: 'USD', unit: 'per-year' })
      .some((i) => /negative/.test(i.message))).toBe(true);
    expect(validateMoneyCandidate('tuition', { value: 500000, currency: 'USD', unit: 'per-year' })
      .some((i) => /ceiling/.test(i.message))).toBe(true);
  });

  it('refuses a figure when the page lists several academic years', () => {
    const y = detectAcademicYear('Fees for 2023-24 and for 2026-27 are shown below.');
    expect(y.ambiguous).toBe(true);
    expect(y.candidates).toEqual(['2023-24', '2026-27']);
    const issues = validateMoneyCandidate('tuition', {
      value: 1000, currency: 'USD', unit: 'per-year',
      academicYearAmbiguous: true, academicYearCandidates: y.candidates,
    });
    expect(issues.some((i) => i.severity === 'error' && /several academic years/.test(i.message))).toBe(true);
  });

  it('does not treat a non-consecutive span as an academic year', () => {
    expect(detectAcademicYear('data from 2020-2024').year).toBeNull();
  });
});

describe('English proficiency extraction', () => {
  it('separates the overall band from a per-section minimum', () => {
    const r = extractIELTS('IELTS 6.5 overall, with no band below 6.0');
    expect(r.find((x) => x.score === 6.5)?.kind).toBe('overall');
    expect(validateIELTS(r).value).toBe(6.5);
  });

  it('refuses when only section minimums are present', () => {
    const r = extractIELTS('A minimum of 6.0 in each IELTS component is required.');
    const v = validateIELTS(r);
    expect(v.value).toBeNull();
    expect(v.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('refuses when a page states two different overall minimums', () => {
    const v = validateIELTS([
      { score: 6.5, kind: 'overall', excerpt: '' },
      { score: 7.0, kind: 'overall', excerpt: '' },
    ]);
    expect(v.value).toBeNull();
    expect(v.issues.some((i) => /conflicting/.test(i.message))).toBe(true);
  });

  it('rejects impossible bands', () => {
    expect(extractIELTS('IELTS 12.5 required')).toHaveLength(0);
    expect(extractIELTS('IELTS 6.3 required')).toHaveLength(0);
  });
});

describe('Testing policy extraction', () => {
  it('reads an unambiguous policy', () => {
    expect(extractTestingPolicy('We are test-optional for 2026-27 entry.').policy).toBe('optional');
  });

  it('returns ambiguous when a stale statement sits beside a current one', () => {
    const r = extractTestingPolicy('The SAT is required. From 2021 we became test-optional.');
    expect(r.ambiguous).toBe(true);
    expect(r.policy).toBeNull();
  });
});

describe('Deadline extraction', () => {
  it('requires deadline wording, not a bare date', () => {
    const bare = extractDeadlines('The campus was founded on 5 January 2027.');
    expect(validateDeadline('applicationDeadline', bare).value).toBeNull();
  });

  it('accepts a labelled in-cycle deadline', () => {
    const ds = extractDeadlines('The application deadline is 5 January 2027.');
    expect(validateDeadline('applicationDeadline', ds).value).toBe('2027-01-05');
  });

  it('rejects an out-of-cycle date as stale', () => {
    const ds = extractDeadlines('The application deadline was 5 January 2019.');
    const v = validateDeadline('applicationDeadline', ds);
    expect(v.value).toBeNull();
    expect(v.issues.some((i) => /outside the current cycle/.test(i.message))).toBe(true);
  });

  it('keeps scholarship deadlines distinct from application deadlines', () => {
    const ds = extractDeadlines('The scholarship deadline is 1 February 2027.');
    expect(ds[0].kind).toBe('scholarship');
  });
});

/* ================================================================== */
/* Aid policy — the highest-risk inferences                            */
/* ================================================================== */

describe('Aid policy never over-claims', () => {
  const base = {
    meetsFullNeed: { found: false }, needBlind: { found: false }, needAware: { found: false },
    fullRide: { found: false }, fullTuition: { found: false }, meritExists: { found: false },
    anyScholarship: { found: false }, internationalEligible: { found: true }, internationalExcluded: { found: false },
  };

  it('does not turn "scholarships exist" into a full ride', () => {
    const { flags } = deriveAidFlags({ ...base, anyScholarship: { found: true }, meritExists: { found: true } });
    expect(flags.fullRidePossible).toBe(false);
    expect(flags.fullTuitionPossible).toBe(false);
    expect(flags.aidCertainty).toBe('competitive');
  });

  it('does not turn full tuition into a full ride', () => {
    const { flags } = deriveAidFlags({ ...base, fullTuition: { found: true } });
    expect(flags.fullTuitionPossible).toBe(true);
    expect(flags.fullRidePossible).toBe(false);
  });

  it('treats a competitive award as different from dependable aid', () => {
    const competitive = deriveAidFlags({ ...base, fullTuition: { found: true } }).flags;
    const dependable = deriveAidFlags({ ...base, meetsFullNeed: { found: true } }).flags;
    expect(competitive.aidCertainty).toBe('competitive');
    expect(dependable.aidCertainty).toBe('meets-full-need');
    expect(competitive.meetsFullNeedForInternationals).toBe(false);
    expect(dependable.meetsFullNeedForInternationals).toBe(true);
  });

  it('records domestic-only aid as unavailable to internationals', () => {
    const { flags } = deriveAidFlags({
      ...base, fullRide: { found: true }, meetsFullNeed: { found: true },
      internationalExcluded: { found: true },
    });
    expect(flags.fullRidePossible).toBe(false);
    expect(flags.needBasedAidForInternationals).toBe(false);
    expect(flags.aidCertainty).toBe('minimal');
  });

  it('will not infer international eligibility from generic aid wording', () => {
    const { flags, issues } = deriveAidFlags({
      ...base, meetsFullNeed: { found: true }, internationalEligible: { found: false },
    });
    expect(flags.meetsFullNeedForInternationals).toBe(false);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('Cross-field consistency', () => {
  it('rejects a full ride that denies full tuition', () => {
    expect(validateRecordConsistency({ fullRidePossible: true, fullTuitionPossible: false })
      .some((i) => i.severity === 'error')).toBe(true);
  });

  it('rejects a total cost below tuition', () => {
    expect(validateRecordConsistency({ tuition: 60000, totalCostOfAttendance: 40000 })
      .some((i) => /below tuition/.test(i.message))).toBe(true);
  });

  it('requires an explicit commitment for meets-full-need certainty', () => {
    expect(validateRecordConsistency({ aidCertainty: 'meets-full-need', meetsFullNeedForInternationals: false })
      .some((i) => i.severity === 'error')).toBe(true);
  });
});

/* ================================================================== */
/* The approval gate                                                   */
/* ================================================================== */

describe('Candidate data cannot become production data on its own', () => {
  it('rejects a high-confidence candidate that has no evidence', () => {
    const v = verdictFor({ issues: [], hasEvidence: false, confidence: 0.99 });
    expect(v.verdict).toBe(VERDICT.REJECT);
    expect(v.reason).toMatch(/no source evidence/);
  });

  it('sends a warning-level candidate to review rather than accepting it', () => {
    const v = verdictFor({
      issues: [{ field: 'tuition', severity: 'warning', message: 'no academic year' }],
      hasEvidence: true, confidence: 0.95,
    });
    expect(v.verdict).toBe(VERDICT.REVIEW_REQUIRED);
  });

  it('sends a low-confidence candidate to review even when clean', () => {
    expect(verdictFor({ issues: [], hasEvidence: true, confidence: 0.6 }).verdict).toBe(VERDICT.REVIEW_REQUIRED);
  });

  it('accepts only a clean, evidenced, high-confidence candidate', () => {
    expect(verdictFor({ issues: [], hasEvidence: true, confidence: 0.95 }).verdict).toBe(VERDICT.ACCEPT);
  });

  it('rejects anything carrying a validation error', () => {
    expect(verdictFor({
      issues: [{ field: 'x', severity: 'error', message: 'bad' }], hasEvidence: true, confidence: 1,
    }).verdict).toBe(VERDICT.REJECT);
  });
});

/* ================================================================== */
/* Common Data Set + end-to-end fixture                                */
/* ================================================================== */

describe('Common Data Set extraction', () => {
  const cds = `
    Common Data Set 2026-27
    C1 First-time, first-year students: Total applicants 27000 Total admitted 1950
    C8 Testing policy: SAT and ACT scores are required of all applicants.
    C9 SAT Composite 25th percentile 1510 75th percentile 1570
    G0 Tuition and fees: $66,720 per year for 2026-27
  `;

  it('detects the document and its academic year', () => {
    const r = extractCommonDataSet(cds);
    expect(r.detected).toBe(true);
    expect(r.academicYear).toBe('2026-27');
  });

  it('reads section-coded fields deterministically', () => {
    const r = extractCommonDataSet(cds);
    expect(r.fields.satPolicy?.value).toBe('required');
    expect(r.fields.tuition?.value).toBe(66720);
    expect(r.fields.admitRate?.value).toBeCloseTo(7.2, 1);
  });

  it('ignores a document that is not a Common Data Set', () => {
    expect(extractCommonDataSet('Welcome to our admissions page.').detected).toBe(false);
  });
});

describe('End-to-end over a fixture page', () => {
  // Proves the chain works without network: HTML -> text -> extraction ->
  // validation -> verdict, with evidence carried through.
  const html = `<html><head><title>Tuition and Fees 2026-27</title></head><body>
    <h1>Tuition and Fees</h1>
    <p>For the 2026-27 academic year, tuition is $66,720 per year.</p>
    <p>Estimated housing is $1,200 per month.</p>
    <p>International students are eligible to apply for need-based aid.</p>
    <p>We meet the full demonstrated need of all admitted students.</p>
    <p>IELTS 7.0 overall is required, with no band below 6.5.</p>
    <p>The application deadline is 1 January 2027.</p>
  </body></html>`;

  const text = htmlToText(html);

  it('extracts the annual tuition and accepts it', () => {
    const m = moneyNear(text, ['tuition']).find((x) => x.isAnnual)!;
    expect(m.value).toBe(66720);
    const year = detectAcademicYear(text);
    const issues = validateMoneyCandidate('tuition', { ...m, academicYear: year.year });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(verdictFor({ issues, hasEvidence: true, confidence: 0.95 }).verdict).toBe(VERDICT.ACCEPT);
  });

  it('refuses the monthly housing figure on the same page', () => {
    const m = moneyNear(text, ['housing'])[0];
    const issues = validateMoneyCandidate('livingCost', m);
    expect(verdictFor({ issues, hasEvidence: true, confidence: 0.9 }).verdict).toBe(VERDICT.REJECT);
  });

  it('reads the IELTS overall band, not the section minimum', () => {
    expect(validateIELTS(extractIELTS(text)).value).toBe(7);
  });

  it('records dependable aid because international eligibility is explicit', () => {
    const { flags } = deriveAidFlags(extractAidPolicy(text));
    expect(flags.meetsFullNeedForInternationals).toBe(true);
    expect(flags.aidCertainty).toBe('meets-full-need');
  });
});

/* ================================================================== */
/* Registry                                                            */
/* ================================================================== */

describe('Registry', () => {
  it('parses every curated university', () => {
    const us = readCuratedUniversities();
    expect(us.length).toBeGreaterThanOrEqual(35);
    for (const u of us) {
      expect(u.id, JSON.stringify(u)).toBeTruthy();
      expect(u.officialUrl).toMatch(/^https:\/\//);
    }
  });

  it('derives registrable domains through multi-part public suffixes', () => {
    expect(rootDomainOf('https://college.harvard.edu')).toBe('harvard.edu');
    expect(rootDomainOf('https://www.ed.ac.uk')).toBe('ed.ac.uk');
    expect(rootDomainOf('https://www.nus.edu.sg')).toBe('nus.edu.sg');
    expect(rootDomainOf('https://en.snu.ac.kr')).toBe('snu.ac.kr');
    expect(rootDomainOf('https://en.uw.edu.pl')).toBe('uw.edu.pl');
  });
});
