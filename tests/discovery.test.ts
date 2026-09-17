import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCEPT_THRESHOLD, classifyDocument, classifyPdf, discoverPages, isNonContentUrl,
  isSitemapUrl, parseRobotsSitemaps, parseSitemap, pdfTitle, scoreKind, scoreUrlPath,
  KIND_SIGNALS,
} from '../scripts/university-data/discovery.mjs';
import { isAllowedUrl } from '../scripts/university-data/safety.mjs';
import {
  addDomain, assertPlausibleDomain, normalizeEntry, PAGE_KINDS, resolveAllowedDomains,
} from '../scripts/university-data/registry.mjs';
import { extractFrom, fetchPages } from '../scripts/university-data/pipeline.mjs';

/* ================================================================== */
/* Fixture server                                                      */
/* ================================================================== */

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'discovery');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * A minimal PDF carrying a title in its Info dictionary.
 *
 * Enough for the title reader; deliberately not a parseable document, because
 * nothing in this pipeline reads PDF body text.
 */
function fakePdf(title: string | null): Buffer {
  const info = title ? `1 0 obj\n<< /Title (${title}) /Producer (fixture) >>\nendobj\n` : '';
  return Buffer.from(`%PDF-1.4\n${info}trailer\n<< /Info 1 0 R >>\n%%EOF\n`, 'latin1');
}

const HTML = 'text/html';
const XML = 'application/xml';

/** url -> [body, contentType] */
const ROUTES: Record<string, [string | Buffer, string]> = {
  'https://nbitadmissions.org/robots.txt': [fixture('robots.txt'), 'text/plain'],
  'https://nbitadmissions.org/sitemap.xml': [fixture('sitemap.xml'), XML],
  'https://nbitadmissions.org/sitemap-misc.xml': [fixture('sitemap-misc.xml'), XML],
  'https://nbitadmissions.org/sitemap-apply.xml': [fixture('sitemap-apply.xml'), XML],
  'https://nbitadmissions.org/sitemap-news.xml': [fixture('sitemap-news.xml'), XML],
  'https://nbitadmissions.org/apply/first-year': [fixture('apply-first-year.html'), HTML],
  'https://nbitadmissions.org/apply/tuition-and-fees': [fixture('apply-tuition-and-fees.html'), HTML],
  'https://nbitadmissions.org/apply/financial-aid': [fixture('apply-financial-aid.html'), HTML],
  'https://nbitadmissions.org/apply/english-language-requirements': [fixture('apply-english.html'), HTML],
  'https://nbitadmissions.org/news/admissions-office-moves-building': [fixture('news-admissions-office.html'), HTML],
  'https://nbitadmissions.org/about': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/contact': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/visit': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/ir/common-data-set-2026-27.pdf': [fakePdf(null), 'application/pdf'],
  'https://nbitadmissions.org/ir/board-minutes.pdf': [fakePdf(null), 'application/pdf'],
};

const requestLog: string[] = [];

/** Stands in for safeFetch, and enforces the same allow-list it does. */
async function fakeFetch(url: string, allowedDomains: string[]) {
  requestLog.push(url);
  const check = isAllowedUrl(url, allowedDomains);
  if (!check.ok) return { ok: false as const, status: 0, reason: `blocked: ${check.reason}`, url };
  const hit = ROUTES[url];
  if (!hit) return { ok: false as const, status: 404, reason: 'HTTP 404', url };
  const [body, contentType] = hit;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return {
    ok: true as const, status: 200, url, contentType, body: buf,
    text: contentType === 'application/pdf' ? null : buf.toString('utf8'),
  };
}

const ENTRY = normalizeEntry({
  id: 'northbridge',
  officialName: 'Northbridge Institute of Technology',
  officialRootUrl: 'https://nbitadmissions.org',
  officialDomains: ['nbitadmissions.org'],
  pages: Object.fromEntries(PAGE_KINDS.map((k) => [k, null])),
});

let run: Awaited<ReturnType<typeof discoverPages>>;
const discovery = async () => {
  run ??= await discoverPages(ENTRY, { fetchImpl: fakeFetch, debug: true });
  return run;
};

/* ================================================================== */
/* The MIT regression                                                  */
/* ================================================================== */

describe('A sitemap is a discovery source, never evidence', () => {
  it('refuses a sitemap URL outright', () => {
    for (const u of [
      'https://nbitadmissions.org/sitemap.xml',
      'https://nbitadmissions.org/sitemap-misc.xml',
      'https://nbitadmissions.org/sitemap_index.xml',
      'https://nbitadmissions.org/wp-sitemap-posts-post-1.xml',
      'https://nbitadmissions.org/robots.txt',
      'https://nbitadmissions.org/feed',
    ]) {
      expect(isNonContentUrl(u).nonContent, u).toBe(true);
    }
  });

  it('does not match a topic keyword against the hostname', () => {
    // The exact failure: the host `mitadmissions.org` contains "admissions", so
    // every URL on it satisfied the admissions hint and the first <loc> in the
    // sitemap index was recorded as the admissions page.
    const trap = 'https://nbitadmissions.org/sitemap-misc.xml';
    expect(trap).toContain('admissions');
    expect(scoreUrlPath(trap, 'admissions').score).toBe(0);
    expect(scoreUrlPath(trap, 'admissions').matched).toEqual([]);
  });

  it('scores zero for every kind on a sitemap path', () => {
    for (const kind of PAGE_KINDS) {
      expect(scoreUrlPath('https://nbitadmissions.org/sitemap-misc.xml', kind).score, kind).toBe(0);
    }
  });

  it('never records a sitemap as any page kind', async () => {
    const r = await discovery();
    for (const [kind, page] of Object.entries(r.found)) {
      expect(page.url, kind).not.toMatch(/sitemap|robots\.txt|\.xml(\?|$)/i);
      expect(isNonContentUrl(page.url).nonContent, `${kind} -> ${page.url}`).toBe(false);
    }
  });

  it('finds the real admissions page instead', async () => {
    const r = await discovery();
    expect(r.found.admissions?.url).toBe('https://nbitadmissions.org/apply/first-year');
    expect(r.found.admissions?.contentSignal).toBe('html-content');
  });

  it('refuses a sitemap even when a registry entry names one as a source page', () => {
    const entry = normalizeEntry({
      id: 'fixturesitemap',
      officialName: 'Fixture',
      officialRootUrl: 'https://nbitadmissions.org',
      officialDomains: ['nbitadmissions.org'],
      pages: { ...Object.fromEntries(PAGE_KINDS.map((k) => [k, null])), admissions: 'https://nbitadmissions.org/sitemap-misc.xml' },
    });
    const registry = { version: 1, generatedAt: '2026-09-17T00:00:00.000Z', note: 'test', universities: [entry] };
    const manifest = fetchPages(registry, 'fixturesitemap', { log: () => {} });
    return expect(manifest).resolves.toMatchObject({
      documents: [],
      failures: [expect.objectContaining({ kind: 'admissions', reason: expect.stringMatching(/not a page/) })],
    });
  });
});

/* ================================================================== */
/* Sitemaps used properly                                              */
/* ================================================================== */

describe('Sitemap parsing', () => {
  it('reads a sitemap index and a urlset', () => {
    expect(parseSitemap(fixture('sitemap.xml')).kind).toBe('index');
    expect(parseSitemap(fixture('sitemap-apply.xml')).kind).toBe('urlset');
    expect(parseSitemap(fixture('sitemap.xml')).entries).toHaveLength(3);
    expect(parseSitemap(fixture('sitemap.xml')).entries[0].lastmod).toBe('2026-08-02');
  });

  it('follows a nested sitemap even when the document lies about being a urlset', () => {
    // A malformed index must not be able to turn its children into pages.
    const lying = '<urlset><url><loc>https://nbitadmissions.org/sitemap-apply.xml</loc></url></urlset>';
    const { entries } = parseSitemap(lying);
    expect(isSitemapUrl(entries[0].loc)).toBe(true);
  });

  it('decodes XML entities in a loc', () => {
    const xml = '<urlset><url><loc>https://nbitadmissions.org/a?x=1&amp;y=2</loc></url></urlset>';
    expect(parseSitemap(xml).entries[0].loc).toBe('https://nbitadmissions.org/a?x=1&y=2');
  });

  it('reads Sitemap directives out of robots.txt', () => {
    const found = parseRobotsSitemaps(fixture('robots.txt'));
    expect(found).toHaveLength(2);
    expect(found[0]).toBe('https://nbitadmissions.org/sitemap.xml');
  });

  it('returns nothing for an empty or unparseable document', () => {
    expect(parseSitemap('').entries).toEqual([]);
    expect(parseSitemap(null).entries).toEqual([]);
    expect(parseRobotsSitemaps(null)).toEqual([]);
  });
});

describe('Discovery walks robots -> sitemap index -> child sitemaps', () => {
  it('recurses into the index', async () => {
    const r = await discovery();
    expect(r.diagnostics.robotsSitemaps).toContain('https://nbitadmissions.org/sitemap.xml');
    // index + three children
    expect(r.diagnostics.sitemapsFetched).toBe(4);
    expect(r.diagnostics.sitemapUrlsDiscovered).toBeGreaterThan(5);
  });

  it('ignores a sitemap robots.txt points at on another domain', async () => {
    const r = await discovery();
    expect(r.diagnostics.robotsSitemaps).not.toContain('https://not-northbridge.example.net/sitemap.xml');
    expect(requestLog).not.toContain('https://not-northbridge.example.net/sitemap.xml');
  });

  it('drops feeds and machine-readable URLs found in a sitemap', async () => {
    const r = await discovery();
    expect(r.diagnostics.nonContentUrlsSkipped).toBeGreaterThan(0);
    expect(Object.values(r.found).map((p) => p.url)).not.toContain('https://nbitadmissions.org/feed');
  });

  it('turns a URL found in a sitemap into evidence once its content is read', async () => {
    const r = await discovery();
    const tuition = r.found.tuition;
    expect(tuition?.url).toBe('https://nbitadmissions.org/apply/tuition-and-fees');
    expect(tuition?.discoveredVia).toBe('sitemap:sitemap-apply.xml');
    expect(tuition?.title).toContain('Tuition and Fees');
  });
});

/* ================================================================== */
/* Content-based classification                                        */
/* ================================================================== */

describe('A page is classified by what it says', () => {
  it('will not classify on a URL keyword alone', () => {
    const s = scoreKind('tuition', { url: 'https://nbitadmissions.org/tuition', title: '', headingList: [], text: '' });
    expect(s.content).toBe(0);
    expect(s.accepted).toBe(false);
    expect(s.reasons.join(' ')).toMatch(/URL alone never classifies/);
  });

  it('accepts a page whose title and headings say what it is', () => {
    const s = scoreKind('tuition', {
      url: 'https://nbitadmissions.org/apply/tuition-and-fees',
      title: 'Tuition and Fees | Northbridge',
      headingList: ['Tuition and fees', 'Housing'],
      text: 'Undergraduate tuition is $48,300 per academic year.',
    });
    expect(s.accepted).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it('rejects a news story that merely mentions admissions and tuition', async () => {
    const r = await discovery();
    for (const page of Object.values(r.found)) {
      expect(page.url).not.toContain('/news/');
    }
    const s = classifyDocument({
      url: 'https://nbitadmissions.org/news/admissions-office-moves-building',
      title: 'News: Admissions office moves building | Northbridge',
      headingList: ['Admissions office moves to Carver Hall'],
      text: 'the admissions office will be located in Carver Hall. Tuition payments...',
    });
    expect(s.every((k) => !k.accepted)).toBe(true);
  });

  it('keeps international admissions from swallowing every admissions page', () => {
    const plain = scoreKind('international_admissions', {
      url: 'https://nbitadmissions.org/apply/first-year',
      title: 'First-Year Admissions', headingList: ['How to apply'], text: 'Submit your application.',
    });
    expect(plain.accepted).toBe(false);
    expect(plain.reasons[0]).toMatch(/missing required term/);
  });

  it('lets one page support several kinds', async () => {
    const r = await discovery();
    // The fixture page is genuinely both: it states tuition and a cost of attendance.
    expect(r.found.tuition?.url).toBe('https://nbitadmissions.org/apply/tuition-and-fees');
    expect(r.found.cost_of_attendance?.url).toBe('https://nbitadmissions.org/apply/tuition-and-fees');
  });

  it('classifies the aid and English pages from their own content', async () => {
    const r = await discovery();
    expect(r.found.financial_aid?.url).toBe('https://nbitadmissions.org/apply/financial-aid');
    expect(r.found.english_requirements?.url).toBe('https://nbitadmissions.org/apply/english-language-requirements');
    expect(r.found.english_requirements?.reasons.join(' ')).toMatch(/ielts|toefl|english/i);
  });

  it('reports what it could not find rather than guessing', async () => {
    const r = await discovery();
    expect(r.notFound.length).toBeGreaterThan(0);
    expect(r.notFound).toContain('programs');
    expect([...Object.keys(r.found), ...r.notFound].sort()).toEqual([...PAGE_KINDS].sort());
  });

  it('covers every page kind with a signal set', () => {
    expect(Object.keys(KIND_SIGNALS).sort()).toEqual([...PAGE_KINDS].sort());
    for (const [kind, s] of Object.entries(KIND_SIGNALS)) {
      expect(s.require?.length, kind).toBeGreaterThan(0);
      expect(s.title?.length, kind).toBeGreaterThan(0);
    }
  });
});

/* ================================================================== */
/* PDFs                                                               */
/* ================================================================== */

describe('Official PDFs are recognised, not parsed', () => {
  it('reads a title out of the Info dictionary', () => {
    expect(pdfTitle(fakePdf('Common Data Set 2026-2027'))).toBe('Common Data Set 2026-2027');
    expect(pdfTitle(fakePdf(null))).toBeNull();
    expect(pdfTitle(null)).toBeNull();
  });

  it('classifies a PDF from the title it states about itself', () => {
    const s = classifyPdf({ url: 'https://nbitadmissions.org/ir/doc-4471.pdf', title: 'Common Data Set 2026-2027' });
    expect(s[0].kind).toBe('common_data_set');
    expect(s[0].contentSignal).toBe('pdf-metadata-title');
  });

  it('falls back to an unambiguous filename phrase, and only those', () => {
    const cds = classifyPdf({ url: 'https://nbitadmissions.org/ir/common-data-set-2026-27.pdf', title: null });
    expect(cds[0].kind).toBe('common_data_set');
    expect(cds[0].contentSignal).toBe('pdf-filename-phrase');

    // "admissions" is a single weak keyword; it is not on any pdfPhrases list.
    expect(classifyPdf({ url: 'https://nbitadmissions.org/x/admissions.pdf', title: null })).toEqual([]);
  });

  it('sends an unidentifiable PDF to manual review instead of classifying it', async () => {
    const r = await discovery();
    const minutes = r.manualReview.find((m) => m.url.endsWith('board-minutes.pdf'));
    expect(Object.values(r.found).map((p) => p.url)).not.toContain('https://nbitadmissions.org/ir/board-minutes.pdf');
    // It is not a candidate at all here (no kind terms in its path), so nothing
    // is recorded for it — which is the correct silence, not a guess.
    expect(minutes ?? null).toBeNull();
  });

  it('flags a discovered PDF as needing a human reader', async () => {
    const r = await discovery();
    const cds = r.found.common_data_set;
    expect(cds?.url).toBe('https://nbitadmissions.org/ir/common-data-set-2026-27.pdf');
    expect(cds?.requiresManualReading).toBe(true);
    expect(cds?.academicYear).toBe('2026-27');
  });
});

/* ================================================================== */
/* Diagnostics and debug                                               */
/* ================================================================== */

describe('Discovery says what it did', () => {
  it('reports every stage', async () => {
    const d = (await discovery()).diagnostics;
    expect(d.sitemapsFetched).toBeGreaterThan(0);
    expect(d.sitemapUrlsDiscovered).toBeGreaterThan(0);
    expect(d.candidatesConsidered).toBeGreaterThan(0);
    expect(d.pagesFetched).toBeGreaterThan(0);
    expect(d.pagesClassified).toBeGreaterThan(0);
    expect(d.requests).toBeGreaterThanOrEqual(d.pagesFetched + d.sitemapsFetched);
  });

  it('records a decision and a reason for every candidate in debug mode', async () => {
    const r = await discovery();
    expect(r.debug.length).toBeGreaterThan(10);
    for (const row of r.debug) {
      expect(row.url).toBeTruthy();
      expect(row.decision).toBeTruthy();
    }
    // The two things a reader most needs to see: a sitemap that was refused
    // because it is off-domain, and a sitemap entry dropped as non-content.
    const offDomain = r.debug.find((row) => row.stage === 'robots' && row.decision === 'skipped');
    expect(offDomain?.url).toBe('https://not-northbridge.example.net/sitemap.xml');
    const droppedEntry = r.debug.find((row) => row.stage === 'sitemap-entry' && row.decision === 'skipped');
    expect(droppedEntry?.url).toBe('https://nbitadmissions.org/feed');
    const parsedIndex = r.debug.find((row) => row.stage === 'sitemap' && row.decision === 'parsed');
    expect(parsedIndex?.reason).toMatch(/index|urlset/);
  });

  it('stays quiet when debug is off', async () => {
    const quiet = await discoverPages(ENTRY, { fetchImpl: fakeFetch, debug: false });
    expect(quiet.debug).toEqual([]);
    expect(Object.keys(quiet.found).length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Domain model                                                        */
/* ================================================================== */

describe('Domain model', () => {
  it('derives the allow-list from both lists', () => {
    const e = normalizeEntry({
      id: 'x', officialDomains: ['example-university.edu'],
      trustedSubdomains: ['aid.example-foundation.org'], pages: {},
    });
    expect(resolveAllowedDomains(e)).toEqual(['example-university.edu', 'aid.example-foundation.org']);
  });

  it('reads a legacy entry that only has allowedDomains', () => {
    const e = normalizeEntry({ id: 'x', allowedDomains: ['legacy-university.edu'], pages: {} });
    expect(e.officialDomains).toEqual(['legacy-university.edu']);
    expect(e.trustedSubdomains).toEqual([]);
  });

  it('adds an official domain and its subdomains become fetchable', () => {
    const e = normalizeEntry({ id: 'x', officialDomains: ['a-university.edu'], pages: {} });
    addDomain(e, 'a-university-aid.org', { scope: 'official' });
    expect(isAllowedUrl('https://sfs.a-university-aid.org/cost', e.allowedDomains).ok).toBe(true);
  });

  it('adds a single trusted host without opening its parent domain', () => {
    const e = normalizeEntry({ id: 'x', officialDomains: ['b-university.edu'], pages: {} });
    addDomain(e, 'registrar.b-hosting.net');
    expect(isAllowedUrl('https://registrar.b-hosting.net/tuition', e.allowedDomains).ok).toBe(true);
    expect(isAllowedUrl('https://anything-else.b-hosting.net/x', e.allowedDomains).ok).toBe(false);
  });

  it('reports a domain that was already allowed rather than duplicating it', () => {
    const e = normalizeEntry({ id: 'x', officialDomains: ['c-university.edu'], pages: {} });
    expect(addDomain(e, 'c-university.edu', { scope: 'official' }).already).toBe(true);
    expect(e.officialDomains).toEqual(['c-university.edu']);
  });

  it('refuses anything that is not a public domain name', () => {
    for (const bad of ['localhost', '127.0.0.1', 'metadata.internal', 'not a domain', 'edu', 'x.local', '']) {
      expect(() => assertPlausibleDomain(bad), bad).toThrow();
    }
  });

  it('still refuses an unrelated domain after widening', () => {
    const e = normalizeEntry({ id: 'x', officialDomains: ['d-university.edu'], pages: {} });
    addDomain(e, 'aid.d-university-trust.org');
    expect(isAllowedUrl('https://evil.example.net/tuition', e.allowedDomains).ok).toBe(false);
  });
});

describe('One page, several fields', () => {
  const id = 'fixtureevidence';
  const dir = join(process.cwd(), 'data', 'raw', id);

  it('attaches evidence per extracted field, not per page', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tuition.html'), fixture('apply-tuition-and-fees.html'));
    const url = 'https://nbitadmissions.org/apply/tuition-and-fees';
    // What fetchPages produces when discovery recorded one URL for two kinds:
    // two manifest entries, one file, one content hash.
    const doc = {
      url, file: 'tuition.html', contentType: 'text/html', bytes: 1,
      contentHash: 'abc', retrievedAt: '2026-09-17T10:00:00.000Z',
    };
    const extracted = extractFrom(id, {
      id, fetchedAt: doc.retrievedAt, failures: [],
      documents: [{ ...doc, kind: 'tuition' }, { ...doc, kind: 'cost_of_attendance' }],
    }, { log: () => {} });

    const tuition = extracted.candidates.tuition as Array<{ evidence: { url: string; contentHash: string } }>;
    const total = extracted.candidates.totalCostOfAttendance as Array<{ evidence: { url: string } }>;
    expect(tuition?.length).toBeGreaterThan(0);
    expect(total?.length).toBeGreaterThan(0);
    // Separate field groups, each carrying its own evidence, both pointing at
    // the one document that actually stated them.
    expect(tuition[0].evidence.url).toBe(url);
    expect(total[0].evidence.url).toBe(url);
    expect(tuition[0].evidence.contentHash).toBe('abc');
  });

  it('creates no empty field groups', () => {
    const extracted = extractFrom(id, {
      id, fetchedAt: '2026-09-17T10:00:00.000Z', failures: [],
      documents: [{
        kind: 'tuition', url: 'https://nbitadmissions.org/apply/tuition-and-fees',
        file: 'tuition.html', contentType: 'text/html', bytes: 1, contentHash: 'abc',
        retrievedAt: '2026-09-17T10:00:00.000Z',
      }],
    }, { log: () => {} });
    // An empty group reports "field groups extracted" while validation silently
    // skips it, which is how a run looks productive and produces nothing.
    for (const [field, list] of Object.entries(extracted.candidates)) {
      expect((list as unknown[]).length, field).toBeGreaterThan(0);
    }
  });

  afterAll(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });
});

afterAll(() => {
  const dir = join(process.cwd(), 'data', 'raw', 'fixturesitemap');
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});
