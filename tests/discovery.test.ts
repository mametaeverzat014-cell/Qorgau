import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCEPT_THRESHOLD, candidatePriority, classifyDocument, classifyPdf, coOccurs,
  collectDomainCandidates, currentAcademicYear, detectAudience, detectTemporal,
  discoverPages, isNonContentUrl, isSitemapUrl, pageDates, parseRobotsSitemaps,
  parseSitemap, pathAuthority, pathSegments, pdfTitle, scoreKind, scoreUrlPath,
  FALLBACK_MIN, KIND_SIGNALS,
} from '../scripts/university-data/discovery.mjs';
import { headings, headingSections, htmlToText, mainContent, pageTitle } from '../scripts/university-data/extract.mjs';
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
  'https://nbitadmissions.org/sitemap-blogs.xml': [fixture('sitemap-blogs.xml'), XML],
  'https://nbitadmissions.org/apply/first-year': [fixture('apply-first-year.html'), HTML],
  'https://nbitadmissions.org/apply/tuition-and-fees': [fixture('apply-tuition-and-fees.html'), HTML],
  'https://nbitadmissions.org/apply/financial-aid': [fixture('apply-financial-aid.html'), HTML],
  'https://nbitadmissions.org/apply/english-language-requirements': [fixture('apply-english.html'), HTML],
  'https://nbitadmissions.org/news/admissions-office-moves-building': [fixture('news-admissions-office.html'), HTML],
  'https://nbitadmissions.org/about': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/contact': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/visit': [fixture('about.html'), HTML],
  'https://nbitadmissions.org/apply/testing-requirements': [fixture('apply-testing-requirements.html'), HTML],
  'https://nbitadmissions.org/apply/first-year/deadlines': [fixture('apply-first-year-deadlines.html'), HTML],
  'https://nbitadmissions.org/apply/transfer/deadlines': [fixture('apply-transfer-deadlines.html'), HTML],
  'https://nbitadmissions.org/dining/menus': [fixture('dining-menus.html'), HTML],
  'https://nbitadmissions.org/blogs/entry/international-students/': [fixture('blog-international-history.html'), HTML],
  'https://nbitadmissions.org/blogs/entry/studying-old-english-at-northbridge/': [fixture('blog-old-english.html'), HTML],
  'https://nbitadmissions.org/blogs/entry/we-are-reinstating-our-sat-act-requirement/': [fixture('blog-sat-reinstated.html'), HTML],
  'https://nbitadmissions.org/blogs/entry/at-what-cost/': [fixture('blog-at-what-cost.html'), HTML],
  'https://nbitadmissions.org/blogs/entry/majors/': [fixture('blog-majors.html'), HTML],
  'https://nbitadmissions.org/ir/common-data-set-2026-27.pdf': [fakePdf(null), 'application/pdf'],
  'https://nbitadmissions.org/ir/board-minutes.pdf': [fakePdf(null), 'application/pdf'],
};

const requestLog: string[] = [];

/** Stands in for safeFetch, and enforces the same allow-list it does. */
async function fakeFetch(url: string, allowedDomains: string[], _opts?: { accept?: string }) {
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
/** Pinned so temporal status does not drift with the calendar. */
const NOW = new Date('2026-09-17T00:00:00.000Z');
const discovery = async () => {
  run ??= await discoverPages(ENTRY, { fetchImpl: fakeFetch, debug: true, now: NOW });
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
    expect(parseSitemap(fixture('sitemap.xml')).entries).toHaveLength(4);
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
    expect(r.diagnostics.sitemapsFetched).toBe(5);
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
    expect(r.notFound).toContain('international_financial_aid');
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
/* The live-run false positives                                        */
/* ================================================================== */

describe('Source selection: the failures a live run produced', () => {
  const doc = (file: string, url: string) => {
    const raw = fixture(file);
    const main = mainContent(raw);
    return {
      url, html: raw, title: pageTitle(raw) ?? '',
      headingList: headings(main.html), text: htmlToText(main.html),
      sections: headingSections(main.html),
    };
  };

  it('A: a history of international students is not an international aid source', async () => {
    // Real failure: "An Early History of International Students at MIT" was
    // recorded as the international financial aid page. Both concepts were on
    // the page; neither was near the other.
    const d = doc('blog-international-history.html', 'https://nbitadmissions.org/blogs/entry/international-students/');
    const s = scoreKind('international_financial_aid', d, NOW);
    expect(s.accepted).toBe(false);
    expect(s.reasons.join(' ')).toMatch(/never together|never in the same/);

    const r = await discovery();
    expect(r.notFound).toContain('international_financial_aid');
    expect(Object.values(r.found).map((p) => p.url))
      .not.toContain('https://nbitadmissions.org/blogs/entry/international-students/');
  });

  it('A2: the same page would qualify if the two ideas were in one paragraph', () => {
    // The rule is co-occurrence, not a blanket ban on the words.
    const near = coOccurs(
      KIND_SIGNALS.international_financial_aid.coRequire![0],
      KIND_SIGNALS.international_financial_aid.coRequire![1],
      { text: 'International students are eligible for need-based financial aid on the same terms.' },
    );
    expect(near.ok).toBe(true);
    const apart = coOccurs(
      KIND_SIGNALS.international_financial_aid.coRequire![0],
      KIND_SIGNALS.international_financial_aid.coRequire![1],
      { sections: [{ heading: 'History', body: 'international students arrived in 1894' }, { heading: 'Endowment', body: 'an endowed scholarship fund' }] },
    );
    expect(apart.ok).toBe(false);
  });

  it('B: studying Old English is not an English proficiency requirement', async () => {
    const d = doc('blog-old-english.html', 'https://nbitadmissions.org/blogs/entry/studying-old-english-at-northbridge/');
    const s = scoreKind('english_requirements', d, NOW);
    expect(s.accepted).toBe(false);
    expect(s.score).toBe(0);
    expect(s.reasons[0]).toMatch(/old english/i);

    const r = await discovery();
    expect(r.found.english_requirements?.url)
      .toBe('https://nbitadmissions.org/apply/english-language-requirements');
  });

  it('B2: the word "English" alone is never proficiency evidence', () => {
    const s = scoreKind('english_requirements', {
      url: 'https://nbitadmissions.org/academics/english',
      title: 'English at Northbridge', headingList: ['English'], text: 'We teach English.',
    }, NOW);
    expect(s.accepted).toBe(false);
    expect(s.reasons.join(' ')).toMatch(/missing required term/);
  });

  it('C: transfer deadlines never outrank first-year deadlines', async () => {
    const r = await discovery();
    expect(r.found.deadlines?.url).toBe('https://nbitadmissions.org/apply/first-year/deadlines');
    expect(r.found.deadlines?.audience).toBe('first_year');

    const transfer = doc('apply-transfer-deadlines.html', 'https://nbitadmissions.org/apply/transfer/deadlines');
    const firstYear = doc('apply-first-year-deadlines.html', 'https://nbitadmissions.org/apply/first-year/deadlines');
    const t = scoreKind('deadlines', transfer, NOW);
    const f = scoreKind('deadlines', firstYear, NOW);
    expect(t.audience).toBe('transfer');
    expect(f.audience).toBe('first_year');
    expect(f.score).toBeGreaterThan(t.score);
    // A transfer page is still a real page — it is demoted, not disqualified.
    expect(t.accepted).toBe(true);
  });

  it('D: a canonical cost page outranks a blog post about cost', async () => {
    const r = await discovery();
    expect(r.found.cost_of_attendance?.url).toBe('https://nbitadmissions.org/apply/tuition-and-fees');
    expect(r.found.cost_of_attendance?.sourceRole).toBe('canonical');
    expect(r.found.cost_of_attendance?.runnerUp?.url).toBe('https://nbitadmissions.org/blogs/entry/at-what-cost/');
    expect(r.found.cost_of_attendance?.runnerUp?.whyItLost).toMatch(/canonical/);
  });

  it('D2: the canonical page wins even when the blog scores higher on keywords', () => {
    const blog = doc('blog-at-what-cost.html', 'https://nbitadmissions.org/blogs/entry/at-what-cost/');
    const canonical = doc('apply-tuition-and-fees.html', 'https://nbitadmissions.org/apply/tuition-and-fees');
    const b = scoreKind('cost_of_attendance', blog, NOW);
    const c = scoreKind('cost_of_attendance', canonical, NOW);
    expect(b.relevance).toBeGreaterThan(c.relevance!);   // keyword-wise the blog wins
    expect(b.authority).toBeLessThan(c.authority!);      // authority-wise it does not
    expect(c.role).toBe('canonical');
    expect(b.role === 'fallback' || b.role === 'historical').toBe(true);
  });

  it('E: a current testing page outranks an older policy announcement', async () => {
    const r = await discovery();
    expect(r.found.testing_policy?.url).toBe('https://nbitadmissions.org/apply/testing-requirements');
    expect(r.found.testing_policy?.temporalStatus).toBe('current');
    expect(r.found.testing_policy?.runnerUp?.url)
      .toBe('https://nbitadmissions.org/blogs/entry/we-are-reinstating-our-sat-act-requirement/');

    const announcement = doc('blog-sat-reinstated.html', 'https://nbitadmissions.org/blogs/entry/we-are-reinstating-our-sat-act-requirement/');
    const s = scoreKind('testing_policy', announcement, NOW);
    expect(s.temporal?.temporalStatus).toBe('historical');
    expect(s.role).toBe('historical');
    expect(s.temporal?.publishedDate).toBe('2022-03-28');
  });

  it('F: global navigation does not make every page an admissions page', async () => {
    // The live run gave nearly every MIT page an admissions score of 7-8.5,
    // because the site template says "how to apply" on all of them.
    const raw = fixture('dining-menus.html');
    expect(htmlToText(raw)).toContain('How to apply');

    const withChrome = classifyDocument({
      url: 'https://nbitadmissions.org/dining/menus',
      title: pageTitle(raw) ?? '', headingList: headings(raw), text: htmlToText(raw),
    }, NOW).find((k) => k.kind === 'admissions')!;
    const stripped = classifyDocument(doc('dining-menus.html', 'https://nbitadmissions.org/dining/menus'), NOW)
      .find((k) => k.kind === 'admissions')!;

    expect(withChrome.content).toBeGreaterThan(0);
    expect(stripped.content).toBe(0);
    expect(stripped.accepted).toBe(false);

    const r = await discovery();
    expect(Object.values(r.found).map((p) => p.url)).not.toContain('https://nbitadmissions.org/dining/menus');
    expect(r.diagnostics.chromeStrippedPages).toBeGreaterThan(0);
  });

  it('F2: chrome stripping keeps the page and drops the furniture', () => {
    const main = mainContent(fixture('apply-tuition-and-fees.html'));
    const text = htmlToText(main.html);
    expect(text).toContain('Undergraduate tuition');
    expect(text).not.toContain('How to apply');
    expect(text).not.toContain('English language requirements');
  });

  it('G: a blog post is still retained when nothing canonical exists', async () => {
    const r = await discovery();
    // There is no standing academics page on this fixture site, and programs is
    // not decision-critical, so the blog is kept and labelled for what it is.
    expect(r.found.programs?.url).toBe('https://nbitadmissions.org/blogs/entry/majors/');
    expect(r.found.programs?.sourceRole).toBe('fallback');
    expect(r.found.programs?.authorityScore).toBeLessThan(0);
  });

  it('H: no canonical source means NOT FOUND, not a false positive', async () => {
    // Same site with the canonical cost page removed: the cost blog is the only
    // candidate left, and a blog is not the institution's statement on cost.
    const hidden = new Set(['https://nbitadmissions.org/apply/tuition-and-fees']);
    const r = await discoverPages(ENTRY, {
      now: NOW,
      fetchImpl: (url: string, domains: string[], opts?: { accept?: string }) =>
        hidden.has(url)
          ? Promise.resolve({ ok: false as const, status: 404, reason: 'HTTP 404', url })
          : fakeFetch(url, domains, opts),
    });

    expect(r.notFound).toContain('cost_of_attendance');
    expect(r.found.cost_of_attendance).toBeUndefined();
    const rejected = r.rejectedForQuality.find((x) => x.kind === 'cost_of_attendance');
    expect(rejected?.url).toBe('https://nbitadmissions.org/blogs/entry/at-what-cost/');
    expect(rejected?.role).toBe('historical');
    expect(rejected?.reason).toMatch(/announces a change in policy/);
    // It is still reported, so a human can look at it.
    expect(r.fallbacks.cost_of_attendance?.url).toBe('https://nbitadmissions.org/blogs/entry/at-what-cost/');
  });
});

/* ================================================================== */
/* Authority, audience and time                                        */
/* ================================================================== */

describe('Authority is judged on whole path segments', () => {
  it('gives no canonical credit for a keyword inside an article slug', () => {
    expect(pathSegments('https://x.edu/news/admissions-office-moves-building'))
      .toEqual(['news', 'admissions office moves building']);
    const a = pathAuthority('https://x.edu/news/admissions-office-moves-building', 'admissions');
    expect(a.canonicalHits).toEqual([]);
    expect(a.blogPath).toBe(true);
    expect(a.score).toBeLessThan(0);
  });

  it('credits a real canonical location', () => {
    const a = pathAuthority('https://x.edu/apply/first-year/deadlines', 'deadlines');
    expect(a.blogPath).toBe(false);
    expect(a.canonicalHits).toContain('deadlines');
    expect(a.score).toBeGreaterThan(0);
  });

  it('penalises a dated permalink', () => {
    expect(pathAuthority('https://x.edu/2019/04/tuition-news', 'tuition').score)
      .toBeLessThan(pathAuthority('https://x.edu/tuition', 'tuition').score);
  });

  it('orders candidates before any request is made', () => {
    const canonical = candidatePriority('https://x.edu/apply/tuition-and-fees', 'tuition');
    const blog = candidatePriority('https://x.edu/blogs/entry/tuition-thoughts', 'tuition');
    expect(canonical.score).toBeGreaterThan(blog.score);
    expect(blog.blogPath).toBe(true);
  });
});

describe('Audience', () => {
  it('reads the audience a page is written for', () => {
    expect(detectAudience({ url: 'https://x.edu/apply/transfer/deadlines' })).toBe('transfer');
    expect(detectAudience({ url: 'https://x.edu/apply/first-year/deadlines' })).toBe('first_year');
    expect(detectAudience({ url: 'https://x.edu/gradadmissions', title: 'Graduate Admissions' })).toBe('graduate');
    expect(detectAudience({ url: 'https://x.edu/admissions/international' })).toBe('international');
    expect(detectAudience({ url: 'https://x.edu/x', title: 'Dining' })).toBe('unknown');
  });

  it('does not read "graduate" out of "undergraduate"', () => {
    expect(detectAudience({ url: 'https://x.edu/undergraduate/admissions' })).toBe('all_undergraduate');
  });
});

describe('Temporal status', () => {
  it('derives the academic year in progress', () => {
    expect(currentAcademicYear(new Date('2026-09-17T00:00:00Z'))).toBe('2026-27');
    expect(currentAcademicYear(new Date('2026-02-01T00:00:00Z'))).toBe('2025-26');
  });

  it('reads dates a page states about itself', () => {
    const d = pageDates(fixture('blog-sat-reinstated.html'));
    expect(d.publishedDate).toBe('2022-03-28');
    expect(pageDates('<html></html>')).toEqual({ publishedDate: null, updatedDate: null });
  });

  it('marks a change announcement on a blog as historical', () => {
    const t = detectTemporal({
      html: fixture('blog-sat-reinstated.html'),
      url: 'https://x.edu/blogs/entry/we-are-reinstating-our-sat-act-requirement/',
      text: 'Today we are announcing that we are reinstating our SAT or ACT requirement, starting in the next cycle.',
      blogLike: true,
    }, NOW);
    expect(t.temporalStatus).toBe('historical');
    expect(t.temporalReasons?.join(' ')).toMatch(/announces a change/);
  });

  it('says unknown rather than inventing currentness', () => {
    const t = detectTemporal({ html: '<html><body>Tuition is due.</body></html>', url: 'https://x.edu/tuition', text: 'Tuition is due.' }, NOW);
    expect(t.temporalStatus).toBe('unknown');
    expect(t.publishedDate).toBeNull();
  });

  it('reads a stated academic year as current', () => {
    const t = detectTemporal({ text: 'Figures apply to the 2026-27 academic year.', url: 'https://x.edu/tuition' }, NOW);
    expect(t.temporalStatus).toBe('current');
    expect(t.academicYear).toBe('2026-27');
  });
});

describe('Cross-domain candidates are proposed, never trusted', () => {
  it('records a linked institutional host for human approval', async () => {
    const r = await discovery();
    const cand = r.domainCandidates.find((d) => d.host === 'sfs.northbridge.edu');
    expect(cand).toBeTruthy();
    expect(cand!.linkedFrom).toBe('https://nbitadmissions.org/apply/financial-aid');
    // Proposed only: it is not in the allow-list and nothing was fetched from it.
    expect(ENTRY.allowedDomains).not.toContain('sfs.northbridge.edu');
    expect(requestLog.some((u) => u.includes('sfs.northbridge.edu'))).toBe(false);
  });

  it('ignores an unrelated host a page links to', () => {
    const found = collectDomainCandidates(
      '<a href="https://studentaid.example.gov/fafsa">federal aid</a><a href="https://sfs.northbridge.edu/x">SFS</a>',
      { allowedDomains: ['nbitadmissions.org'], nameTokens: ['northbridge', 'nbitadmissions'] },
    );
    expect(found.map((f) => f.host)).toEqual(['sfs.northbridge.edu']);
  });
});

describe('Every FOUND result explains itself', () => {
  it('carries both scores, the role, the audience and the runner-up', async () => {
    const r = await discovery();
    for (const [kind, page] of Object.entries(r.found)) {
      expect(typeof page.relevanceScore, kind).toBe('number');
      expect(typeof page.authorityScore, kind).toBe('number');
      expect(['canonical', 'supporting', 'fallback', 'historical'], kind).toContain(page.sourceRole);
      expect(['current', 'dated', 'historical', 'unknown'], kind).toContain(page.temporalStatus);
      expect(page.whySelected, kind).toBeTruthy();
      if (page.runnerUp) expect(page.runnerUp.whyItLost, kind).toBeTruthy();
    }
  });

  it('prefers precision: decision-critical kinds are canonical or absent', async () => {
    const r = await discovery();
    for (const kind of Object.keys(KIND_SIGNALS)) {
      if (!KIND_SIGNALS[kind].decisionCritical) continue;
      const page = r.found[kind];
      if (!page) continue;
      const weak = page.sourceRole === 'fallback' || page.sourceRole === 'historical';
      if (weak) expect(page.score, kind).toBeGreaterThanOrEqual(FALLBACK_MIN);
    }
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
    const quiet = await discoverPages(ENTRY, { fetchImpl: fakeFetch, debug: false, now: NOW });
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
