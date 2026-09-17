import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  extractAidPolicy, extractDeadlines, extractIELTS, extractMoneyScoped, htmlToText,
  mainContent, moneyNear, nonCostContext,
} from '../scripts/university-data/extract.mjs';
import { deriveAidFlags, EVIDENCE, VERDICT } from '../scripts/university-data/validate.mjs';
import { extractFrom, validateCandidates } from '../scripts/university-data/pipeline.mjs';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'extraction');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const main = (name: string) => mainContent(fixture(name)).html;
const aid = (name: string) => deriveAidFlags(extractAidPolicy(htmlToText(main(name))));

/* ================================================================== */
/* Extraction reads the page, not the template                         */
/* ================================================================== */

describe('Extraction ignores site chrome', () => {
  const raw = fixture('chrome-trap.html');
  const cleaned = htmlToText(main('chrome-trap.html'));

  it('the trap is real: the chrome carries every value we extract', () => {
    const whole = htmlToText(raw);
    expect(whole).toContain('$200,000');
    expect(whole).toContain('IELTS 9.0');
    expect(whole).toContain('SAT');
    expect(whole).toContain('1 December 2026');
    expect(whole).toContain('Scholarships');
  });

  it('and none of it survives into the content extraction reads', () => {
    expect(cleaned).toContain('Carver Library');
    expect(cleaned).not.toContain('$200,000');
    expect(cleaned).not.toContain('IELTS');
    expect(cleaned).not.toContain('SAT');
    expect(cleaned).not.toContain('December 2026');
  });

  it('extracts no money from a page whose only figures are in the chrome', () => {
    expect(extractMoneyScoped(main('chrome-trap.html'), ['tuition'])).toHaveLength(0);
    expect(extractMoneyScoped(main('chrome-trap.html'), ['scholarship'])).toHaveLength(0);
  });

  it('extracts no IELTS band or deadline from the chrome', () => {
    expect(extractIELTS(cleaned)).toHaveLength(0);
    expect(extractDeadlines(cleaned)).toHaveLength(0);
  });

  it('would have extracted all of them from the raw page', () => {
    // Stated as a regression guard: if this ever stops being true, the fixture
    // has lost its teeth and the test above proves nothing.
    const whole = htmlToText(raw);
    expect(extractIELTS(whole).length).toBeGreaterThan(0);
    expect(extractDeadlines(whole).length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Money semantics                                                     */
/* ================================================================== */

describe('A number in a sentence about income is not a price', () => {
  it('names the reason a figure is not a cost', () => {
    expect(nonCostContext('Families with income below $200,000 pay nothing.')).toMatch(/income/);
    expect(nonCostContext('Scholarships of up to $30,000 are available.')).toMatch(/maximum award/);
    expect(nonCostContext('The median starting salary is $95,000.')).toMatch(/earnings/);
    expect(nonCostContext('Tuition is $59,750 per year.')).toBeNull();
  });

  it('keeps the tuition figure and drops the income threshold', () => {
    // The live failure: $200,000 was extracted as tuition from a sentence about
    // families below that income attending tuition-free. The sentence contains
    // the word "tuition", so a keyword filter cannot catch it.
    const { kept, excluded } = extractMoneyScoped(main('income-threshold.html'), ['tuition'], { withExcluded: true });
    expect(kept.map((m) => m.value)).toEqual([59750]);
    expect(excluded.map((m) => m.value)).toContain(200000);
    expect(excluded.find((m) => m.value === 200000)?.excludedBecause).toMatch(/income/);
  });

  it('drops a scholarship maximum rather than reading it as a price', () => {
    const { kept, excluded } = extractMoneyScoped(main('income-threshold.html'), ['scholarships'], { withExcluded: true });
    expect(excluded.map((m) => m.value)).toContain(30000);
    expect(kept.map((m) => m.value)).not.toContain(30000);
  });

  it('still applies the plausibility ceiling as a second defence', () => {
    // moneyNear has no structural context, so the guard must hold there too.
    const text = 'Tuition: families with household income below $200,000 pay nothing.';
    expect(moneyNear(text, ['tuition'])).toHaveLength(0);
  });
});

/* ================================================================== */
/* Year-aware money                                                    */
/* ================================================================== */

describe('A figure inherits the year its own structure states', () => {
  it('reads a year from the table column header', () => {
    const rows = extractMoneyScoped(main('cost-table-two-years.html'), ['tuition']);
    expect(rows.map((r) => [r.value, r.academicYear, r.academicYearSource])).toEqual([
      [57590, '2025-26', 'table-column'],
      [59750, '2026-27', 'table-column'],
    ]);
  });

  it('keeps the figures in each row distinct', () => {
    const housing = extractMoneyScoped(main('cost-table-two-years.html'), ['housing']);
    expect(housing.map((r) => r.value)).toEqual([12000, 12500]);
    expect(housing.every((r) => r.academicYearSource === 'table-column')).toBe(true);
  });

  it('reads a year from the enclosing heading section', () => {
    const rows = extractMoneyScoped(main('cost-sections-by-year.html'), ['tuition']);
    expect(rows.map((r) => [r.value, r.academicYear, r.academicYearSource])).toEqual([
      [59750, '2026-27', 'section'],
      [57590, '2025-26', 'section'],
    ]);
  });

  it('gives a figure to the cost component named nearest to it', () => {
    // One sentence prices two things. The sentence contains "tuition", so a
    // keyword filter alone makes the housing figure a tuition candidate.
    const tuition = extractMoneyScoped(main('cost-sections-by-year.html'), ['tuition']);
    const housing = extractMoneyScoped(main('cost-sections-by-year.html'), ['housing']);
    expect(tuition.map((r) => r.value)).toEqual([59750, 57590]);
    expect(housing.map((r) => r.value)).toEqual([12500, 12000]);
  });

  it('refuses to attribute a year from mixed prose', () => {
    // Three academic years in one paragraph, attributable to nothing. Guessing
    // the nearest one is exactly what this must not do.
    const rows = extractMoneyScoped(main('cost-ambiguous-prose.html'), ['tuition']);
    expect(rows).toHaveLength(1);
    expect(rows[0].academicYear).toBeNull();
    expect(rows[0].academicYearAmbiguous).toBe(true);
    expect(rows[0].academicYearCandidates).toEqual(['2024-25', '2025-26', '2026-27']);
  });

  it('a multi-year page no longer loses every figure on it', () => {
    // The live run refused a whole cost page because it listed three years.
    // Structure-scoped attribution keeps the ones the page itself disambiguates.
    const table = extractMoneyScoped(main('cost-table-two-years.html'), ['tuition']);
    expect(table.every((r) => r.academicYear && !r.academicYearAmbiguous)).toBe(true);
  });
});

/* ================================================================== */
/* Aid certainty: three-state evidence                                 */
/* ================================================================== */

describe('Unknown evidence never becomes "competitive"', () => {
  it('A: a generic aid page proposes nothing', () => {
    // The live failure: meets-full-need -> competitive, from a page that says
    // nothing about international eligibility and nothing about how aid is won.
    const { flags, evidence } = aid('aid-generic.html');
    expect(flags.aidCertainty).toBeNull();
    expect(evidence.aidCertainty.state).toBe(EVIDENCE.UNKNOWN);
    expect(evidence.aidCertainty.reason).toMatch(/never states whether international students are eligible/);
  });

  it('B: explicit competitive wording proposes competitive', () => {
    const { flags, evidence } = aid('aid-competitive.html');
    expect(flags.aidCertainty).toBe('competitive');
    expect(evidence.aidCertainty.state).toBe(EVIDENCE.SUPPORTED);
    expect(evidence.aidCertainty.reason).toMatch(/describes the award as a contest/);
  });

  it('C: full demonstrated need plus international applicability proposes meets-full-need', () => {
    const { flags, evidence } = aid('aid-full-need.html');
    expect(flags.aidCertainty).toBe('meets-full-need');
    expect(evidence.meetsFullNeedForInternationals.state).toBe(EVIDENCE.SUPPORTED);
  });

  it('D: no international applicability means no international aid mutation', () => {
    const { flags, evidence } = aid('aid-generic.html');
    for (const field of ['needBasedAidForInternationals', 'meetsFullNeedForInternationals', 'fullRidePossible', 'fullTuitionPossible'] as const) {
      expect(flags[field], field).toBeNull();
      expect(evidence[field].state, field).toBe(EVIDENCE.UNKNOWN);
    }
  });

  it('D2: competitive wording without international applicability proposes nothing', () => {
    const signals = extractAidPolicy(
      'Our merit scholarships are highly competitive and awarded to a small number of applicants.',
    );
    expect(signals.competitiveAward.found).toBe(true);
    const { flags, evidence } = deriveAidFlags(signals);
    expect(flags.aidCertainty).toBeNull();
    expect(evidence.aidCertainty.state).toBe(EVIDENCE.UNKNOWN);
  });

  it('E: absence of full-need wording is not evidence against full need', () => {
    const { flags, evidence } = aid('aid-competitive.html');
    expect(flags.meetsFullNeedForInternationals).toBeNull();
    expect(evidence.meetsFullNeedForInternationals.state).toBe(EVIDENCE.UNKNOWN);
    expect(evidence.meetsFullNeedForInternationals.reason).toMatch(/that is not evidence that it is not/);
  });

  it('records an explicit exclusion as contradiction, which is evidence', () => {
    const { flags, evidence } = deriveAidFlags(extractAidPolicy(
      'These awards are restricted to domestic students. International students are not eligible.',
    ));
    expect(evidence.fullRidePossible.state).toBe(EVIDENCE.CONTRADICTED);
    expect(flags.fullRidePossible).toBe(false);
    expect(flags.aidCertainty).toBe('minimal');
  });
});

/* ================================================================== */
/* Through the real pipeline                                           */
/* ================================================================== */

describe('Review distinguishes four outcomes', () => {
  const id = 'fixtureextraction';
  const dir = join(process.cwd(), 'data', 'raw', id);

  const run = (docs: Array<{ kind: string; file: string; source: string }>) => {
    mkdirSync(dir, { recursive: true });
    for (const d of docs) writeFileSync(join(dir, d.file), fixture(d.source));
    const manifest = {
      id, fetchedAt: '2026-09-17T10:00:00.000Z', failures: [],
      documents: docs.map((d) => ({
        kind: d.kind, url: `https://example-university.edu/${d.kind}`, file: d.file,
        contentType: 'text/html', bytes: 1, contentHash: `hash-${d.kind}`,
        retrievedAt: '2026-09-17T10:00:00.000Z',
      })),
    };
    const extracted = extractFrom(id, manifest, { log: () => {} });
    return { extracted, validated: validateCandidates(id, extracted, { log: () => {} }) };
  };

  it('proposes a tuition figure with the year its table states', () => {
    const { validated } = run([{ kind: 'tuition', file: 'tuition.html', source: 'cost-table-two-years.html' }]);
    const p = validated.proposals.tuition;
    expect(p.value).toBe(59750);            // the most recent cycle on the page
    expect(p.evidence[0].academicYear).toBe('2026-27');
    expect(p.issues.some((i) => /table column/.test(i.message))).toBe(true);
  });

  it('never proposes aidCertainty from a generic aid page', () => {
    const { validated } = run([{ kind: 'financial_aid', file: 'financial_aid.html', source: 'aid-generic.html' }]);
    expect(validated.proposals.aidCertainty).toBeUndefined();
    expect(validated.rejected.some((r) => r.field === 'aidCertainty')).toBe(false);
    const gap = validated.noEvidence.find((n) => n.field === 'aidCertainty');
    expect(gap).toBeTruthy();
    expect(gap!.reason).toMatch(/international students are eligible/);
  });

  it('proposes aidCertainty when the page states it', () => {
    const { validated } = run([{ kind: 'financial_aid', file: 'financial_aid.html', source: 'aid-full-need.html' }]);
    expect(validated.proposals.aidCertainty?.value).toBe('meets-full-need');
    expect(validated.proposals.aidCertainty?.evidence).toHaveLength(1);
    expect(validated.noEvidence.some((n) => n.field === 'aidCertainty')).toBe(false);
  });

  it('reports a figure it found and declined to use', () => {
    const { validated } = run([{ kind: 'tuition', file: 'tuition.html', source: 'income-threshold.html' }]);
    const dropped = validated.excludedFigures.find((f) => f.value === 200000);
    expect(dropped).toBeTruthy();
    expect(dropped!.reason).toMatch(/income/);
    expect(validated.proposals.tuition?.value).toBe(59750);
  });

  it('extracts nothing at all from a page that is only chrome', () => {
    const { extracted, validated } = run([{ kind: 'tuition', file: 'tuition.html', source: 'chrome-trap.html' }]);
    expect(Object.keys(extracted.candidates)).toHaveLength(0);
    expect(Object.keys(validated.proposals)).toHaveLength(0);
    expect(extracted.contentCleaned).toBe(1);
  });

  it('keeps the four outcomes separate', () => {
    const { validated } = run([
      { kind: 'tuition', file: 'tuition.html', source: 'cost-table-two-years.html' },
      { kind: 'financial_aid', file: 'financial_aid.html', source: 'aid-generic.html' },
    ]);
    expect(Object.keys(validated.proposals).length).toBeGreaterThan(0);
    expect(validated.noEvidence.length).toBeGreaterThan(0);
    // Nothing appears in two buckets at once.
    const proposed = new Set(Object.keys(validated.proposals));
    for (const n of validated.noEvidence) expect(proposed.has(n.field)).toBe(false);
    for (const r of validated.rejected) expect(proposed.has(r.field)).toBe(false);
    expect(VERDICT.NO_EVIDENCE).toBe('NO_EVIDENCE');
  });

  afterAll(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    const extractedDir = join(process.cwd(), 'data', 'extracted', id);
    if (existsSync(extractedDir)) rmSync(extractedDir, { recursive: true, force: true });
  });
});
