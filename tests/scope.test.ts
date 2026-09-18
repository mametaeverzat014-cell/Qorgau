import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectApplicantScope, headings, htmlToText, mainContent, headingSections,
  extractMoneyScoped, extractIELTS, pageTitle,
  APPLICANT_SCOPES, EXCLUDED_SCOPES, FIRST_YEAR_SCOPES, scopeServesFirstYear,
} from '../scripts/university-data/extract.mjs';
import {
  scopeMayServeField, validateMoneyCandidate, verdictFor, SCOPE_GUARDED_FIELDS, VERDICT,
} from '../scripts/university-data/validate.mjs';
import { compareCandidates, scoreKind } from '../scripts/university-data/discovery.mjs';
import { extractFrom, validateCandidates } from '../scripts/university-data/pipeline.mjs';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'scope');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const NOW = new Date('2026-09-18T00:00:00.000Z');

const doc = (file: string, url: string) => {
  const raw = fixture(file);
  const cleaned = mainContent(raw);
  return {
    url, html: raw, title: pageTitle(raw) ?? '',
    headingList: headings(cleaned.html), text: htmlToText(cleaned.html),
    sections: headingSections(cleaned.html),
  };
};

const FIRST_YEAR = 'https://college.eastvale.edu/admissions/apply/first-year-applicants';
const VISITING = 'https://college.eastvale.edu/admissions/apply/visiting-undergraduate-students';
const INTERNATIONAL = 'https://college.eastvale.edu/admissions/apply/international-applicants';
const TRANSFER = 'https://college.eastvale.edu/admissions/apply/transfer-applicants';
const GRADUATE = 'https://college.eastvale.edu/gradadmissions';

/* ================================================================== */
/* Scope classification                                                */
/* ================================================================== */

describe('Applicant scope', () => {
  it('reads the population a page is written for', () => {
    expect(detectApplicantScope(doc('apply-first-year-applicants.html', FIRST_YEAR)).scope).toBe('first_year');
    expect(detectApplicantScope(doc('apply-visiting-undergraduate-students.html', VISITING)).scope).toBe('visiting');
    expect(detectApplicantScope(doc('apply-transfer-applicants.html', TRANSFER)).scope).toBe('transfer');
    expect(detectApplicantScope(doc('graduate-admissions.html', GRADUATE)).scope).toBe('graduate');
  });

  it('does not read "visiting undergraduate" as an undergraduate page', () => {
    // The exact trap: the excluding word and the including word are both in the
    // title, and the one that excludes has to win.
    const s = detectApplicantScope(doc('apply-visiting-undergraduate-students.html', VISITING));
    expect(VISITING).toContain('undergraduate');
    expect(s.scope).toBe('visiting');
    expect(s.excluded).toBe(true);
    expect(s.markers).toContain('visiting');
  });

  it('treats international as a facet, not a different applicant level', () => {
    const s = detectApplicantScope(doc('apply-international-applicants.html', INTERNATIONAL));
    expect(s.scope).toBe('international_first_year');
    expect(s.level).toBe('first_year');
    expect(s.international).toBe(true);
    expect(s.excluded).toBe(false);
    expect(scopeServesFirstYear(s.scope)).toBe(true);
  });

  it('classifies an international page with no stated level as unknown, not excluded', () => {
    const s = detectApplicantScope({ url: 'https://x.edu/admissions/international', title: 'International Students' });
    expect(s.scope).toBe('unknown');
    expect(s.international).toBe(true);
    expect(scopeServesFirstYear(s.scope)).toBe(true);
  });

  it('will not let a passing mention in body text exclude a page', () => {
    // A first-year page that says "transfer applicants should see this page"
    // is still a first-year page.
    const s = detectApplicantScope({
      url: 'https://x.edu/admissions/apply/first-year-applicants',
      title: 'First-Year Applicants',
      text: 'If you are a transfer applicant or a visiting student, see the other pages.',
    });
    expect(s.scope).toBe('first_year');
  });

  it('recognises continuing education and study abroad', () => {
    expect(detectApplicantScope({ url: 'https://x.edu/extension', title: 'Extension School' }).scope)
      .toBe('continuing_education');
    expect(detectApplicantScope({ url: 'https://x.edu/study-abroad', title: 'Study Abroad' }).scope)
      .toBe('study_abroad');
  });

  it('keeps the vocabulary and the exclusion list consistent', () => {
    for (const s of [...EXCLUDED_SCOPES, ...FIRST_YEAR_SCOPES]) expect(APPLICANT_SCOPES).toContain(s);
    for (const s of EXCLUDED_SCOPES) expect(FIRST_YEAR_SCOPES).not.toContain(s);
    expect(FIRST_YEAR_SCOPES).toContain('unknown');
  });
});

/* ================================================================== */
/* A, B, G — ranking                                                   */
/* ================================================================== */

describe('Scope outranks keywords and freshness', () => {
  const firstYear = () => scoreKind('admissions', doc('apply-first-year-applicants.html', FIRST_YEAR), NOW);
  const visiting = () => scoreKind('admissions', doc('apply-visiting-undergraduate-students.html', VISITING), NOW);

  it('A: the first-year page wins admissions and the visiting page is refused', () => {
    const f = firstYear();
    const v = visiting();
    expect(f.accepted).toBe(true);
    expect(f.applicantScope?.scope).toBe('first_year');
    expect(v.accepted).toBe(false);
    expect(v.applicantScope?.scope).toBe('visiting');
    expect(v.reasons[0]).toMatch(/written for visiting applicants.*not first-year undergraduates/);
  });

  it('B: the visiting page is keyword-rich and current, and still loses', () => {
    // Both halves of the trap, asserted: it really is the stronger-looking page.
    const raw = doc('apply-visiting-undergraduate-students.html', VISITING);
    const asIfInScope = scoreKind('admissions', { ...raw, applicantScope: { scope: 'unknown', markers: [], excluded: false } }, NOW);
    const f = firstYear();
    expect(asIfInScope.relevance).toBeGreaterThan(0);
    expect(asIfInScope.temporal?.temporalStatus).toBe('current');
    expect(asIfInScope.accepted).toBe(true);

    // Scope is a gate, so the real comparison never even reaches the score.
    expect(visiting().accepted).toBe(false);
    // And where two in-scope pages compete, scope still sorts above score.
    const thin = { ...f, score: 99, applicantScope: { scope: 'unknown' }, role: 'canonical' };
    const explicit = { ...f, score: 1, applicantScope: { scope: 'first_year' }, role: 'canonical' };
    expect(compareCandidates(explicit as never, thin as never)).toBeLessThan(0);
  });

  it('B2: a current wrong-scope page cannot beat an undated first-year page', () => {
    // The live shape exactly: the wrong-scope page carried a date and the
    // first-year page did not.
    const dated = { role: 'canonical', score: 22.5, applicantScope: { scope: 'visiting' }, temporal: { temporalStatus: 'current' }, audience: 'unknown' };
    const undated = { role: 'canonical', score: 16.5, applicantScope: { scope: 'first_year' }, temporal: { temporalStatus: 'unknown' }, audience: 'first_year' };
    expect(compareCandidates(undated as never, dated as never)).toBeLessThan(0);

    // And in practice it never gets that far: the visiting page is refused.
    expect(visiting().accepted).toBe(false);
  });

  it('G: an international first-year page stays eligible', () => {
    const intl = scoreKind('international_admissions', doc('apply-international-applicants.html', INTERNATIONAL), NOW);
    expect(intl.accepted).toBe(true);
    expect(intl.applicantScope?.scope).toBe('international_first_year');

    const english = scoreKind('english_requirements', doc('apply-international-applicants.html', INTERNATIONAL), NOW);
    expect(english.accepted).toBe(true);
  });

  it('refuses a graduate page for undergraduate kinds', () => {
    const g = scoreKind('tuition', doc('graduate-admissions.html', GRADUATE), NOW);
    expect(g.accepted).toBe(false);
    expect(g.reasons[0]).toMatch(/written for graduate applicants/);
  });

  it('leaves institution-wide kinds unguarded', () => {
    // A Common Data Set is not written for an applicant population at all.
    expect(scopeMayServeField('programs', 'graduate').ok).toBe(true);
    const guarded = SCOPE_GUARDED_FIELDS;
    expect(guarded).toContain('tuition');
    expect(guarded).toContain('minimumIELTS');
    expect(guarded).toContain('satPolicy');
    expect(guarded).toContain('applicationDeadline');
    expect(guarded).toContain('aidCertainty');
  });
});

/* ================================================================== */
/* C — per-class money                                                 */
/* ================================================================== */

describe('A per-class price is not an annual price', () => {
  it('C: $7,778.25 per class is refused as annual tuition', () => {
    const rows = extractMoneyScoped(mainContent(fixture('cost-per-class.html')).html, ['tuition']);
    const perClass = rows.find((r) => r.value === 7778.25);
    expect(perClass).toBeTruthy();
    expect(perClass!.unit).toBe('per-course');
    expect(perClass!.isAnnual).toBe(false);

    const issues = validateMoneyCandidate('tuition', perClass!);
    expect(issues.some((i) => i.severity === 'error' && /per-course/.test(i.message))).toBe(true);
    expect(verdictFor({ issues, hasEvidence: true, confidence: 0.9 }).verdict).toBe(VERDICT.REJECT);
  });

  it('C2: and is not annualised into a total cost of attendance either', () => {
    // The figure sits under a "Cost of Attendance" heading. A heading is not a
    // total: the total must be stated in the figure's own sentence.
    const totals = extractMoneyScoped(mainContent(fixture('cost-per-class.html')).html, ['total', 'cost of attendance', 'estimated cost']);
    expect(totals.map((t) => t.value)).not.toContain(7778.25);
    expect(totals).toHaveLength(0);
  });

  it('refuses per-credit, per-month and per-week the same way', () => {
    for (const unit of ['per-course', 'per-credit', 'per-month', 'per-week'] as const) {
      const issues = validateMoneyCandidate('tuition', { value: 1000, currency: 'USD', unit, academicYear: '2026-27' });
      expect(issues.some((i) => i.severity === 'error'), unit).toBe(true);
    }
  });

  it('accepts an explicitly annual figure', () => {
    const rows = extractMoneyScoped(mainContent(fixture('apply-first-year-applicants.html')).html, ['tuition']);
    expect(rows[0].value).toBe(58400);
    expect(rows[0].unit).toBe('per-year');
    expect(validateMoneyCandidate('tuition', rows[0]).filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});

/* ================================================================== */
/* D, E, F, H — through the real pipeline                              */
/* ================================================================== */

describe('Extraction refuses a wrong-scope source even if discovery passes it', () => {
  const id = 'fixturescope';
  const dir = join(process.cwd(), 'data', 'raw', id);

  const run = (docs: Array<{ kind: string; url: string; source: string }>) => {
    mkdirSync(dir, { recursive: true });
    for (const d of docs) writeFileSync(join(dir, `${d.kind}.html`), fixture(d.source));
    const manifest = {
      id, fetchedAt: '2026-09-18T10:00:00.000Z', failures: [],
      documents: docs.map((d) => ({
        kind: d.kind, url: d.url, file: `${d.kind}.html`, contentType: 'text/html',
        bytes: 1, contentHash: `hash-${d.kind}`, retrievedAt: '2026-09-18T10:00:00.000Z',
      })),
    };
    const extracted = extractFrom(id, manifest, { log: () => {} });
    return { extracted, validated: validateCandidates(id, extracted, { log: () => {} }) };
  };

  it('D: a visiting-student IELTS 6 never reaches first-year minimumIELTS', () => {
    // The page really does state it — this is a true fact about the wrong people.
    const visitingText = htmlToText(mainContent(fixture('apply-visiting-undergraduate-students.html')).html);
    expect(extractIELTS(visitingText).some((c) => c.score === 6)).toBe(true);

    const { extracted, validated } = run([
      { kind: 'admissions', url: VISITING, source: 'apply-visiting-undergraduate-students.html' },
    ]);
    expect(extracted.candidates.minimumIELTS).toBeUndefined();
    expect(validated.proposals.minimumIELTS).toBeUndefined();
    const gap = validated.noEvidence.find((n) => n.field === 'minimumIELTS');
    expect(gap?.reason).toMatch(/written for visiting applicants/);
  });

  it('E: a visiting-student SAT policy is not accepted as first-year evidence', () => {
    const { extracted, validated } = run([
      { kind: 'testing_policy', url: VISITING, source: 'apply-visiting-undergraduate-students.html' },
    ]);
    expect(extracted.candidates.satPolicy).toBeUndefined();
    expect(validated.proposals.satPolicy).toBeUndefined();
    expect(validated.noEvidence.some((n) => n.field === 'satPolicy')).toBe(true);
  });

  it('F: transfer deadlines never populate the first-year deadline', () => {
    const { extracted, validated } = run([
      { kind: 'deadlines', url: TRANSFER, source: 'apply-transfer-applicants.html' },
    ]);
    expect(extracted.candidates.applicationDeadline).toBeUndefined();
    expect(validated.proposals.applicationDeadline).toBeUndefined();
    expect(validated.noEvidence.some((n) => n.field === 'applicationDeadline')).toBe(true);
  });

  it('refuses the per-class fee and the term housing figure from a visiting page', () => {
    const { extracted, validated } = run([
      { kind: 'tuition', url: VISITING, source: 'apply-visiting-undergraduate-students.html' },
    ]);
    for (const field of ['tuition', 'livingCost', 'totalCostOfAttendance']) {
      expect(extracted.candidates[field], field).toBeUndefined();
      expect(validated.proposals[field], field).toBeUndefined();
    }
    expect(validated.noEvidence.some((n) => n.field === 'tuition')).toBe(true);
  });

  it('H: only wrong-scope sources means no mutation at all', () => {
    const { validated } = run([
      { kind: 'admissions', url: VISITING, source: 'apply-visiting-undergraduate-students.html' },
      { kind: 'deadlines', url: TRANSFER, source: 'apply-transfer-applicants.html' },
      { kind: 'tuition', url: GRADUATE, source: 'graduate-admissions.html' },
    ]);
    expect(Object.keys(validated.proposals)).toHaveLength(0);
    expect(validated.rejected).toHaveLength(0);          // nothing was extracted to reject
    expect(validated.noEvidence.length).toBeGreaterThan(0);
    for (const n of validated.noEvidence) expect(n.reason).toMatch(/written for .* applicants|never states/);
  });

  it('G2: an international first-year page still supplies international fields', () => {
    const { extracted, validated } = run([
      { kind: 'english_requirements', url: INTERNATIONAL, source: 'apply-international-applicants.html' },
      { kind: 'international_financial_aid', url: INTERNATIONAL, source: 'apply-international-applicants.html' },
    ]);
    expect(extracted.candidates.minimumIELTS).toBeTruthy();
    expect(validated.proposals.minimumIELTS?.value).toBe(7.5);
    expect(validated.proposals.aidCertainty?.value).toBe('meets-full-need');
  });

  it('a first-year page supplies first-year fields normally', () => {
    const { validated } = run([
      { kind: 'admissions', url: FIRST_YEAR, source: 'apply-first-year-applicants.html' },
      { kind: 'tuition', url: FIRST_YEAR, source: 'apply-first-year-applicants.html' },
    ]);
    expect(validated.proposals.tuition?.value).toBe(58400);
    expect(validated.proposals.minimumIELTS?.value).toBe(7.5);
    expect(validated.proposals.satPolicy?.value).toBe('optional');
  });

  it('records the scope of every source it read', () => {
    const { extracted } = run([
      { kind: 'admissions', url: VISITING, source: 'apply-visiting-undergraduate-students.html' },
    ]);
    expect(extracted.sourceScopes).toEqual([
      expect.objectContaining({ kind: 'admissions', url: VISITING, scope: 'visiting' }),
    ]);
  });

  afterAll(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const extractedDir = join(process.cwd(), 'data', 'extracted', id);
    if (existsSync(extractedDir)) rmSync(extractedDir, { recursive: true, force: true });
  });
});
