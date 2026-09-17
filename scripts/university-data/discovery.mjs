/**
 * Page discovery.
 *
 * This module exists because of a real failure. Running discovery against MIT
 * returned exactly one "page": `https://mitadmissions.org/sitemap-misc.xml`,
 * recorded as the admissions page. Two mistakes combined to produce it:
 *
 *   1. candidate URLs were matched against the whole URL string, and the host
 *      `mitadmissions.org` literally contains the substring "admissions", so
 *      every URL on that host satisfied the admissions hint;
 *   2. a sitemap was treated as a page, because nothing ever looked at what the
 *      document actually said.
 *
 * The rules this module enforces, in order of importance:
 *
 *   - A sitemap, sitemap index or robots.txt is a DISCOVERY SOURCE. It can
 *     never be classified as admissions, tuition, aid or anything else.
 *   - Hostnames are never matched against topic keywords. Only `URL.pathname`
 *     is, and a path match on its own is never enough to classify a page.
 *   - A page is classified from what it says: its title, its H1/H2/H3 and its
 *     body text. The URL and the sitemap it came from are weak supporting
 *     signals, never the deciding one.
 *   - One page may legitimately support several page kinds (a "Tuition and
 *     Financial Aid" page is both), so classification is per kind, not
 *     winner-takes-all.
 */

import { htmlToText, pageTitle, headings, detectAcademicYear } from './extract.mjs';
import { safeFetch, isAllowedUrl, looksLikeChallenge, LIMITS } from './safety.mjs';

/* ------------------------------------------------------------------ */
/* Text normalisation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Lowercases and reduces anything non-alphanumeric to a single space, then pads
 * the result so a term can be matched with spaces on both sides.
 *
 * The padding is what makes matching word-shaped: " aid " does not match
 * "aids", and "cost of attendance" still matches across the original hyphens,
 * slashes or underscores it was written with.
 */
export function normalise(s) {
  return ` ${String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

const term = (t) => normalise(t).trim();

/** True when a normalised haystack contains a term as whole words. */
export function hasTerm(haystack, t) {
  const needle = term(t);
  return needle.length > 0 && haystack.includes(` ${needle} `);
}

const hits = (haystack, terms) => terms.filter((t) => hasTerm(haystack, t));

/**
 * How much one matched term is worth.
 *
 * A phrase is far stronger evidence than a word: a page titled "Common Data
 * Set" is that document, while a page titled "Aid" could be anything. Each
 * extra word is worth half again, capped so a long phrase cannot dominate.
 */
const hitWeight = (t) => Math.min(2, 1 + 0.5 * (term(t).split(' ').length - 1));
const weigh = (matched) => matched.reduce((sum, t) => sum + hitWeight(t), 0);

/* ------------------------------------------------------------------ */
/* Non-content URLs                                                    */
/* ------------------------------------------------------------------ */

/** Path suffixes that are never a readable page. */
const NON_CONTENT_EXTENSIONS = [
  '.xml', '.xml.gz', '.gz', '.json', '.rss', '.atom', '.txt.gz',
  '.css', '.js', '.mjs', '.map', '.ics', '.zip', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.mp4', '.mp3',
];

/** Path fragments that mark a machine-readable index rather than a page. */
const NON_CONTENT_FRAGMENTS = [
  'sitemap', 'robots txt', 'wp json', 'wp content', 'wp includes',
  'feed', 'rss', 'atom', 'oembed', 'wp sitemap',
];

/**
 * Decides whether a URL can ever be evidence.
 *
 * This is the single guard that stops the MIT failure recurring: it is applied
 * before a URL becomes a candidate, again before a fetched document is
 * classified, and again in the fetch stage, so a hand-edited registry cannot
 * smuggle a sitemap in either.
 */
export function isNonContentUrl(rawUrl) {
  let path;
  try {
    const u = new URL(rawUrl);
    path = `${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return { nonContent: true, reason: 'unparseable URL' };
  }
  if (path === '/robots.txt') return { nonContent: true, reason: 'robots.txt is a discovery source, not a page' };
  for (const ext of NON_CONTENT_EXTENSIONS) {
    if (path.endsWith(ext)) return { nonContent: true, reason: `${ext} is not a readable page` };
  }
  const normalised = normalise(path);
  for (const frag of NON_CONTENT_FRAGMENTS) {
    if (hasTerm(normalised, frag)) {
      return { nonContent: true, reason: `"${frag}" marks a machine-readable index, not a page` };
    }
  }
  return { nonContent: false, reason: null };
}

/** True for a sitemap or sitemap index URL, which is followed but never classified. */
export function isSitemapUrl(rawUrl) {
  let path;
  try {
    path = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return false;
  }
  return hasTerm(normalise(path), 'sitemap') || path.endsWith('.xml') || path.endsWith('.xml.gz');
}

/* ------------------------------------------------------------------ */
/* Sitemap and robots parsing                                          */
/* ------------------------------------------------------------------ */

const decodeXmlEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/**
 * Parses a sitemap or sitemap index.
 *
 * `kind` is reported from the document's own root element, but callers should
 * not trust it: a `<loc>` that is itself a sitemap is enqueued as a child
 * sitemap regardless of what the root element claimed. A malformed index that
 * declares `<urlset>` must not be able to turn its children into pages.
 */
export function parseSitemap(xml) {
  if (!xml) return { kind: 'unknown', entries: [] };
  const kind = /<sitemapindex[\s>]/i.test(xml) ? 'index'
    : /<urlset[\s>]/i.test(xml) ? 'urlset'
    : 'unknown';
  const entries = [];
  const blocks = xml.match(/<(?:url|sitemap)\b[\s\S]*?<\/(?:url|sitemap)>/gi);
  const source = blocks ?? [xml];
  for (const block of source) {
    const loc = block.match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1];
    if (!loc) continue;
    entries.push({
      loc: decodeXmlEntities(loc),
      lastmod: block.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1] ?? null,
    });
  }
  // A flat document with several <loc> and no <url> wrappers still parses.
  if (entries.length === 0) {
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      entries.push({ loc: decodeXmlEntities(m[1]), lastmod: null });
    }
  }
  return { kind, entries };
}

/** Reads `Sitemap:` directives out of robots.txt. */
export function parseRobotsSitemaps(text) {
  if (!text) return [];
  return [...text.matchAll(/^[ \t]*sitemap[ \t]*:[ \t]*(\S+)/gim)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ */
/* Per-kind signals                                                    */
/* ------------------------------------------------------------------ */

/**
 * What each page kind looks like.
 *
 * `require` is a list of groups; every group must match at least one of its
 * alternatives somewhere in the combined corpus. That is what keeps
 * "international financial aid" from swallowing every aid page.
 *
 * `pdfPhrases` are the only signals strong enough to classify a PDF, which has
 * no readable body here. They are deliberately narrow.
 */
export const KIND_SIGNALS = {
  admissions: {
    require: [['admission', 'admissions', 'apply', 'applying', 'application', 'applicants']],
    path: ['admissions', 'admission', 'apply', 'applying', 'first year', 'freshman'],
    title: ['admissions', 'admission', 'apply', 'application'],
    heading: ['how to apply', 'admissions', 'application', 'first year applicants'],
    text: ['how to apply', 'application process', 'first year applicants', 'apply for admission',
      'admissions office', 'application requirements', 'submit your application'],
    negative: ['graduate admissions', 'transfer credit policy'],
  },
  international_admissions: {
    require: [
      ['international', 'overseas'],
      ['admission', 'admissions', 'apply', 'applying', 'applicant', 'applicants', 'application', 'student', 'students'],
    ],
    path: ['international', 'international students', 'international applicants'],
    title: ['international'],
    heading: ['international applicants', 'international students'],
    text: ['international applicants', 'international students', 'student visa', 'study permit',
      'if you are an international student'],
    negative: ['international news', 'global campus news'],
  },
  tuition: {
    require: [['tuition', 'fees', 'fee']],
    path: ['tuition', 'fees', 'tuition and fees', 'fee schedule'],
    title: ['tuition', 'fees'],
    heading: ['tuition', 'fees', 'tuition and fees'],
    text: ['tuition and fees', 'annual tuition', 'tuition rate', 'per academic year', 'tuition per year'],
    negative: [],
    pdfPhrases: ['tuition and fees', 'fee schedule', 'tuition fees'],
  },
  cost_of_attendance: {
    require: [['cost', 'costs', 'budget', 'expenses']],
    path: ['cost of attendance', 'cost', 'budget', 'student budget', 'expenses'],
    title: ['cost of attendance', 'cost', 'budget'],
    heading: ['cost of attendance', 'estimated cost', 'student budget'],
    text: ['cost of attendance', 'estimated cost of attendance', 'student budget', 'total estimated cost'],
    negative: [],
    pdfPhrases: ['cost of attendance'],
  },
  financial_aid: {
    require: [['aid', 'financial', 'funding', 'affordability', 'affording']],
    path: ['financial aid', 'finaid', 'aid', 'funding', 'affording', 'student financial services'],
    title: ['financial aid', 'aid', 'financial services', 'funding'],
    heading: ['financial aid', 'types of aid', 'applying for aid'],
    text: ['financial aid', 'need based', 'apply for financial aid', 'css profile', 'fafsa',
      'demonstrated need', 'aid package'],
    negative: ['first aid'],
  },
  international_financial_aid: {
    require: [
      ['international', 'overseas', 'non citizens'],
      ['aid', 'financial', 'funding', 'scholarship', 'scholarships'],
    ],
    path: ['international', 'international aid', 'aid for international students'],
    title: ['international'],
    heading: ['international students', 'aid for international students'],
    text: ['international students', 'aid for international', 'international applicants are eligible',
      'need blind for international', 'need aware for international'],
    negative: [],
  },
  scholarships: {
    require: [['scholarship', 'scholarships', 'award', 'awards', 'bursary', 'bursaries', 'merit']],
    path: ['scholarships', 'scholarship', 'awards', 'merit scholarships', 'bursaries'],
    title: ['scholarships', 'scholarship', 'awards'],
    heading: ['scholarships', 'merit scholarships', 'named scholarships'],
    text: ['scholarship', 'scholarships', 'merit based', 'award covers', 'full tuition scholarship'],
    negative: [],
  },
  testing_policy: {
    require: [['sat', 'act', 'test', 'tests', 'testing', 'standardized', 'standardised']],
    path: ['testing', 'standardized testing', 'test optional', 'sat act', 'tests', 'test policy'],
    title: ['testing', 'test', 'sat', 'act', 'test optional'],
    heading: ['testing policy', 'standardized testing', 'test optional', 'standardised testing'],
    text: ['test optional', 'test blind', 'sat or act', 'standardized testing', 'we require the sat',
      'testing policy', 'act scores'],
    negative: ['covid testing', 'health testing', 'drug testing'],
  },
  english_requirements: {
    require: [['english', 'ielts', 'toefl', 'duolingo', 'proficiency']],
    path: ['english', 'english language requirements', 'english proficiency', 'language requirements'],
    title: ['english', 'english language', 'english proficiency'],
    heading: ['english proficiency', 'english language requirement', 'english language requirements'],
    text: ['ielts', 'toefl', 'duolingo english test', 'english language proficiency', 'minimum overall band'],
    negative: ['english department', 'english literature', 'english major'],
  },
  deadlines: {
    require: [['deadline', 'deadlines', 'dates', 'timeline', 'calendar']],
    path: ['deadlines', 'dates', 'key dates', 'important dates', 'application deadlines'],
    title: ['deadlines', 'dates', 'deadline'],
    heading: ['deadlines', 'important dates', 'application dates', 'key dates'],
    text: ['application deadline', 'early action', 'early decision', 'regular decision',
      'deadlines', 'priority deadline'],
    negative: ['academic calendar of events', 'events calendar'],
  },
  programs: {
    require: [['program', 'programs', 'programme', 'programmes', 'majors', 'academics', 'degrees', 'courses']],
    path: ['academics', 'programs', 'programmes', 'majors', 'degrees', 'fields of study', 'courses'],
    title: ['academics', 'programs', 'programmes', 'majors', 'degrees'],
    heading: ['undergraduate programs', 'majors', 'fields of study', 'degree programs'],
    text: ['majors', 'degree programs', 'fields of study', 'undergraduate programs', 'course catalog'],
    negative: [],
  },
  common_data_set: {
    require: [['common data set', 'cds']],
    path: ['common data set', 'cds', 'institutional research'],
    title: ['common data set'],
    heading: ['common data set'],
    text: ['common data set', 'first time first year', 'cds a', 'cds c'],
    negative: [],
    pdfPhrases: ['common data set', 'cds'],
  },
};

/** Applied to the title and path of every candidate, whatever the kind. */
const GLOBAL_NEGATIVE = [
  'sitemap', 'robots', 'news', 'blog', 'press release', 'newsroom', 'privacy policy',
  'terms of use', 'log in', 'login', 'sign in', 'staff directory', 'directory',
  'careers', 'jobs', 'search results', 'page not found', '404', 'archive', 'events',
];

const WEIGHTS = { title: 3, heading: 2, text: 1, path: 1, sitemap: 0.5, negative: -4 };
/** Body-text hits beyond this add nothing; a long page should not outrank a precise one. */
const TEXT_HIT_CAP = 4;
/** Below this a candidate is not classified at all. */
export const ACCEPT_THRESHOLD = 4;

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Scores a URL's PATH ONLY for a kind.
 *
 * Note what is absent: the hostname. `mitadmissions.org/sitemap-misc.xml`
 * scores zero for admissions here, which is the whole point.
 */
export function scoreUrlPath(rawUrl, kind) {
  const signals = KIND_SIGNALS[kind];
  if (!signals) return { score: 0, matched: [] };
  let path;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    return { score: 0, matched: [] };
  }
  const hay = normalise(path);
  const matched = hits(hay, signals.path ?? []);
  // Depth penalty: /admissions/international beats /a/b/c/d/e/admissions-news.
  const segments = path.split('/').filter(Boolean).length;
  const depthPenalty = segments > 5 ? 0.5 : 0;
  return { score: Math.max(0, weigh(matched) * WEIGHTS.path - depthPenalty), matched };
}

/**
 * Scores one fetched document against one kind.
 *
 * `content` is the part that comes from the document itself. A candidate with
 * `content === 0` is never accepted, no matter how suggestive its URL is.
 */
export function scoreKind(kind, { url = '', title = '', headingList = [], text = '', sitemapContext = '' } = {}) {
  const signals = KIND_SIGNALS[kind];
  if (!signals) return { kind, score: 0, content: 0, accepted: false, reasons: ['unknown kind'] };

  const hayTitle = normalise(title);
  const hayHeadings = normalise(headingList.join(' . '));
  const hayText = normalise(text.slice(0, 200_000));
  const hayPath = (() => { try { return normalise(new URL(url).pathname); } catch { return normalise(url); } })();
  const hayContext = normalise(sitemapContext);
  const corpus = `${hayTitle}${hayHeadings}${hayText}${hayPath}`;

  const reasons = [];

  // Every require-group must be satisfied somewhere, or the kind is not this page.
  for (const group of signals.require ?? []) {
    if (!group.some((t) => hasTerm(corpus, t))) {
      return { kind, score: 0, content: 0, accepted: false, reasons: [`missing required term (${group.slice(0, 3).join('/')})`] };
    }
  }

  const titleHits = hits(hayTitle, signals.title ?? []);
  const headingHits = hits(hayHeadings, signals.heading ?? []);
  const textHits = hits(hayText, signals.text ?? []);
  const pathHits = hits(hayPath, signals.path ?? []);
  const contextHits = hits(hayContext, signals.path ?? []);

  const negatives = [
    ...hits(`${hayTitle}${hayPath}`, GLOBAL_NEGATIVE),
    ...hits(corpus, signals.negative ?? []),
  ];

  const content =
    weigh(titleHits) * WEIGHTS.title +
    weigh(headingHits) * WEIGHTS.heading +
    weigh(textHits.slice(0, TEXT_HIT_CAP)) * WEIGHTS.text;

  const score =
    content +
    weigh(pathHits) * WEIGHTS.path +
    weigh(contextHits) * WEIGHTS.sitemap +
    negatives.length * WEIGHTS.negative;

  if (titleHits.length) reasons.push(`title: ${titleHits.join(', ')}`);
  if (headingHits.length) reasons.push(`headings: ${headingHits.join(', ')}`);
  if (textHits.length) reasons.push(`body: ${textHits.slice(0, TEXT_HIT_CAP).join(', ')}`);
  if (pathHits.length) reasons.push(`path: ${pathHits.join(', ')}`);
  if (contextHits.length) reasons.push(`sitemap context: ${contextHits.join(', ')}`);
  if (negatives.length) reasons.push(`negative: ${negatives.join(', ')}`);

  // content > 0 is the rule that forbids classifying on a URL keyword alone.
  const accepted = content > 0 && score >= ACCEPT_THRESHOLD;
  if (!accepted && content === 0) reasons.push('no signal in the document itself — URL alone never classifies');

  return { kind, score: Number(score.toFixed(2)), content, accepted, reasons };
}

/** Scores a document against every kind; a page may legitimately serve several. */
export function classifyDocument(doc) {
  return Object.keys(KIND_SIGNALS)
    .map((kind) => scoreKind(kind, doc))
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* PDF handling                                                        */
/* ------------------------------------------------------------------ */

/**
 * Pulls the document title out of a PDF's Info dictionary.
 *
 * This is metadata the document carries about itself, not a guess from the URL.
 * When it is absent the PDF is recorded for manual reading rather than
 * classified, because there is nothing here that reads PDF body text.
 */
export function pdfTitle(buffer) {
  if (!buffer?.length) return null;
  const head = Buffer.from(buffer).subarray(0, 300_000).toString('latin1');
  const utf16 = head.match(/\/Title\s*<((?:FEFF|feff)[0-9A-Fa-f]+)>/)?.[1];
  if (utf16) {
    const hex = utf16.slice(4);
    let out = '';
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (Number.isNaN(code) || code === 0) break;
      out += String.fromCharCode(code);
    }
    return out.trim().slice(0, 200) || null;
  }
  const plain = head.match(/\/Title\s*\(((?:\\.|[^)\\]){1,200})\)/)?.[1];
  return plain ? plain.replace(/\\([()\\])/g, '$1').trim().slice(0, 200) || null : null;
}

/**
 * Classifies a PDF.
 *
 * A PDF has no body text here, so only two things can classify it: a title the
 * document states about itself, or one of a short list of unambiguous filename
 * phrases. Either way the result is marked as needing a human to read it.
 */
export function classifyPdf({ url, title }) {
  const out = [];
  for (const [kind, signals] of Object.entries(KIND_SIGNALS)) {
    if (title) {
      const s = scoreKind(kind, { url, title, headingList: [], text: '' });
      if (s.accepted) { out.push({ ...s, contentSignal: 'pdf-metadata-title' }); continue; }
    }
    const phrases = signals.pdfPhrases ?? [];
    if (!phrases.length) continue;
    let path;
    try { path = normalise(new URL(url).pathname); } catch { continue; }
    const matched = hits(path, phrases);
    if (matched.length) {
      out.push({
        kind, score: weigh(matched) * WEIGHTS.title, content: 0, accepted: true,
        contentSignal: 'pdf-filename-phrase',
        reasons: [`filename phrase: ${matched.join(', ')}`],
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Conventional path guesses                                           */
/* ------------------------------------------------------------------ */

/**
 * Paths worth trying when a sitemap yields nothing.
 *
 * These are guesses to probe, never recorded facts. A 200 response plus a
 * successful content classification is what makes one real; anything that does
 * not respond, or responds with the wrong content, is simply dropped.
 */
export const CANDIDATE_PATHS = {
  admissions: ['/admissions', '/apply', '/undergraduate/admissions', '/admissions/undergraduate'],
  international_admissions: ['/admissions/international', '/international/admissions', '/international-students', '/international'],
  tuition: ['/tuition', '/fees', '/admissions/tuition', '/tuition-and-fees', '/student-financial-services/tuition'],
  cost_of_attendance: ['/cost-of-attendance', '/cost', '/financial-aid/cost-of-attendance', '/admissions/cost'],
  financial_aid: ['/financial-aid', '/finaid', '/aid', '/student-financial-services'],
  international_financial_aid: ['/financial-aid/international', '/finaid/international', '/aid/international-students'],
  scholarships: ['/scholarships', '/financial-aid/scholarships', '/admissions/scholarships'],
  testing_policy: ['/admissions/testing', '/apply/testing', '/standardized-testing', '/admissions/tests'],
  english_requirements: ['/admissions/english', '/english-language-requirements', '/admissions/english-proficiency'],
  deadlines: ['/admissions/deadlines', '/apply/deadlines', '/admissions/dates-and-deadlines'],
  programs: ['/academics', '/programs', '/undergraduate/programs', '/academics/programs'],
  common_data_set: ['/common-data-set', '/ir/common-data-set', '/institutional-research/common-data-set'],
};

export const DISCOVERY_LIMITS = {
  /** Sitemap documents fetched per institution, including the index itself. */
  maxSitemapFetches: 12,
  /** How deep a sitemap index may nest. */
  maxSitemapDepth: 3,
  /** URLs retained from all sitemaps combined. */
  maxSitemapUrls: 20_000,
  /** Candidate pages actually fetched and classified. */
  maxContentFetches: 45,
  /** Top-scoring sitemap candidates tried per kind. */
  maxCandidatesPerKind: 4,
};

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

const lastSegment = (url) => {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''; } catch { return ''; }
};

/**
 * Discovers official pages for one institution.
 *
 * Bounded and deterministic: robots.txt -> sitemaps (recursing into indexes) ->
 * path-ranked candidates -> fetch -> classify by content. There is no
 * link-following crawl, and every URL at every stage is re-checked against the
 * institution's allow-list.
 */
export async function discoverPages(entry, {
  fetchImpl = safeFetch,
  log = () => {},
  debug = false,
  limits = DISCOVERY_LIMITS,
  maxRequests = LIMITS.maxPagesPerDomain,
} = {}) {
  const domains = entry.allowedDomains;
  const kinds = Object.keys(KIND_SIGNALS);
  const found = {};
  const debugRows = [];
  const manualReview = [];
  const diagnostics = {
    robotsSitemaps: [], sitemapsFetched: 0, sitemapUrlsDiscovered: 0,
    nonContentUrlsSkipped: 0, candidatesConsidered: 0, pagesFetched: 0,
    pagesClassified: 0, requests: 0, budgetExhausted: false,
  };

  const note = (row) => { if (debug) debugRows.push(row); };
  const budgetLeft = () => diagnostics.requests < maxRequests + limits.maxContentFetches;

  const fetchOnce = async (url, opts) => {
    diagnostics.requests++;
    return fetchImpl(url, domains, opts);
  };

  /* ---- 1. robots.txt names the sitemaps ---- */
  const robotsUrl = new URL('/robots.txt', entry.officialRootUrl).toString();
  const robots = await fetchOnce(robotsUrl, { accept: 'text/plain' });
  const sitemapQueue = [];
  if (robots.ok && robots.text) {
    for (const s of parseRobotsSitemaps(robots.text)) {
      if (isAllowedUrl(s, domains).ok) {
        diagnostics.robotsSitemaps.push(s);
        sitemapQueue.push({ url: s, depth: 0, context: lastSegment(s) });
      } else {
        note({ url: s, stage: 'robots', decision: 'skipped', reason: 'sitemap outside the allow-list' });
      }
    }
  }
  note({ url: robotsUrl, stage: 'robots', status: robots.status, decision: robots.ok ? 'parsed' : 'unavailable', reason: robots.reason ?? null });

  /* ---- 2. conventional sitemap locations as a fallback ---- */
  if (sitemapQueue.length === 0) {
    for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
      sitemapQueue.push({ url: new URL(p, entry.officialRootUrl).toString(), depth: 0, context: lastSegment(p) });
    }
  }

  /* ---- 3. walk the sitemaps, recursing into indexes ---- */
  const sitemapSeen = new Set();
  let skipsNoted = 0;
  /** @type {Map<string,{url:string,context:string,lastmod:string|null}>} */
  const contentUrls = new Map();

  while (sitemapQueue.length > 0 && diagnostics.sitemapsFetched < limits.maxSitemapFetches) {
    const { url, depth, context } = sitemapQueue.shift();
    if (sitemapSeen.has(url) || depth > limits.maxSitemapDepth) continue;
    sitemapSeen.add(url);

    const res = await fetchOnce(url, { accept: 'application/xml,text/xml,text/plain' });
    diagnostics.sitemapsFetched++;
    if (!res.ok || !res.text) {
      note({ url, stage: 'sitemap', status: res.status, decision: 'unavailable', reason: res.reason ?? null });
      continue;
    }
    const { kind, entries } = parseSitemap(res.text);
    note({ url, stage: 'sitemap', status: res.status, decision: 'parsed', reason: `${kind}, ${entries.length} entries` });

    for (const e of entries) {
      if (!isAllowedUrl(e.loc, domains).ok) continue;
      // A <loc> that is itself a sitemap is followed, never classified — even
      // when the document claimed to be a <urlset>.
      if (isSitemapUrl(e.loc)) {
        if (!sitemapSeen.has(e.loc)) sitemapQueue.push({ url: e.loc, depth: depth + 1, context: lastSegment(e.loc) });
        continue;
      }
      const nc = isNonContentUrl(e.loc);
      if (nc.nonContent) {
        diagnostics.nonContentUrlsSkipped++;
        // Capped: a real sitemap holds thousands of these and the point of
        // --debug is to be readable.
        if (skipsNoted < 50) { skipsNoted++; note({ url: e.loc, stage: 'sitemap-entry', decision: 'skipped', reason: nc.reason }); }
        continue;
      }
      if (contentUrls.size >= limits.maxSitemapUrls) break;
      if (!contentUrls.has(e.loc)) contentUrls.set(e.loc, { url: e.loc, context, lastmod: e.lastmod });
    }
  }
  diagnostics.sitemapUrlsDiscovered = contentUrls.size;

  /* ---- 4. rank candidates by path score, per kind ---- */
  /** @type {Map<string,{url:string,context:string,pathScore:number,kinds:string[]}>} */
  const candidates = new Map();
  const consider = (url, context, kind, pathScore) => {
    const nc = isNonContentUrl(url);
    if (nc.nonContent) {
      diagnostics.nonContentUrlsSkipped++;
      note({ url, stage: 'candidate', decision: 'rejected', reason: nc.reason });
      return;
    }
    if (!isAllowedUrl(url, domains).ok) return;
    const prev = candidates.get(url);
    if (prev) {
      prev.pathScore = Math.max(prev.pathScore, pathScore);
      if (!prev.kinds.includes(kind)) prev.kinds.push(kind);
      return;
    }
    candidates.set(url, { url, context, pathScore, kinds: [kind] });
  };

  for (const kind of kinds) {
    const ranked = [...contentUrls.values()]
      .map((c) => ({ ...c, ...scoreUrlPath(c.url, kind) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
      .slice(0, limits.maxCandidatesPerKind);
    for (const c of ranked) consider(c.url, c.context, kind, c.score);

    for (const p of CANDIDATE_PATHS[kind] ?? []) {
      consider(new URL(p, entry.officialRootUrl).toString(), 'conventional-path', kind, 0.25);
    }
  }
  diagnostics.candidatesConsidered = candidates.size;

  /* ---- 5. fetch and classify ---- */
  const ordered = [...candidates.values()].sort((a, b) => b.pathScore - a.pathScore);
  const retrievedAt = new Date().toISOString();

  for (const cand of ordered) {
    if (diagnostics.pagesFetched >= limits.maxContentFetches || !budgetLeft()) {
      diagnostics.budgetExhausted = true;
      break;
    }
    // Stop early once every kind has a confident page.
    if (kinds.every((k) => found[k]?.score >= ACCEPT_THRESHOLD * 2)) break;

    const res = await fetchOnce(cand.url);
    diagnostics.pagesFetched++;
    if (!res.ok) {
      note({ url: cand.url, stage: 'fetch', status: res.status, decision: 'rejected', reason: res.reason });
      continue;
    }
    // Re-check after redirects: a redirect can land on a sitemap or a feed.
    const ncFinal = isNonContentUrl(res.url);
    if (ncFinal.nonContent) {
      diagnostics.nonContentUrlsSkipped++;
      note({ url: res.url, stage: 'fetch', status: res.status, decision: 'rejected', reason: `after redirect: ${ncFinal.reason}` });
      continue;
    }
    if (res.text && looksLikeChallenge(res.text)) {
      note({ url: res.url, stage: 'fetch', status: res.status, decision: 'rejected', reason: 'bot challenge page, not real content' });
      continue;
    }

    const isPdf = res.contentType === 'application/pdf';
    const isHtml = res.contentType === 'text/html' || res.contentType === 'application/xhtml+xml' || res.contentType === 'text/plain' || !res.contentType;
    if (!isPdf && !isHtml) {
      note({ url: res.url, stage: 'classify', status: res.status, contentType: res.contentType, decision: 'rejected', reason: `${res.contentType} is not a readable page` });
      continue;
    }

    let scored;
    let title = null;
    let academicYear = null;

    if (isPdf) {
      title = pdfTitle(res.body);
      scored = classifyPdf({ url: res.url, title });
      academicYear = detectAcademicYear(`${title ?? ''} ${lastSegment(res.url)}`).year;
      if (scored.length === 0) {
        manualReview.push({
          url: res.url, title, retrievedAt, contentType: res.contentType,
          reason: 'official PDF found, but nothing in the document itself identifies its subject — read it manually',
        });
        note({ url: res.url, stage: 'classify', status: res.status, contentType: res.contentType, decision: 'manual-review', reason: 'PDF without an identifying title' });
        continue;
      }
    } else {
      title = pageTitle(res.text ?? '') ?? '';
      const text = htmlToText(res.text ?? '');
      const headingList = headings(res.text ?? '');
      academicYear = detectAcademicYear(text).year;
      scored = classifyDocument({ url: res.url, title, headingList, text, sitemapContext: cand.context });
    }
    diagnostics.pagesClassified++;

    const accepted = scored.filter((s) => s.accepted);
    note({
      url: res.url, stage: 'classify', status: res.status, contentType: res.contentType,
      title, decision: accepted.length ? 'accepted' : 'rejected',
      scores: scored.slice(0, 4).map((s) => `${s.kind}=${s.score}`),
      reason: accepted.length
        ? accepted.map((s) => `${s.kind}: ${s.reasons.join('; ')}`).join(' | ')
        : scored[0]?.reasons.join('; ') ?? 'no kind matched',
    });

    // One page may support several kinds; each is recorded independently.
    for (const s of accepted) {
      if (found[s.kind] && found[s.kind].score >= s.score) continue;
      found[s.kind] = {
        url: res.url, title: title || null, score: s.score, reasons: s.reasons,
        contentType: res.contentType, academicYear, retrievedAt,
        contentSignal: s.contentSignal ?? 'html-content',
        requiresManualReading: isPdf,
        discoveredVia: cand.context === 'conventional-path' ? 'conventional-path' : `sitemap:${cand.context}`,
      };
    }
  }

  const notFound = kinds.filter((k) => !found[k]);
  const status = Object.keys(found).length === kinds.length ? 'complete'
    : Object.keys(found).length > 0 ? 'partial'
    : 'failed';

  log(`  discovery: ${Object.keys(found).length}/${kinds.length} page kinds found`);
  log(`    ${diagnostics.requests} requests · ${diagnostics.sitemapsFetched} sitemaps · ${diagnostics.sitemapUrlsDiscovered} sitemap URLs · ${diagnostics.candidatesConsidered} candidates · ${diagnostics.pagesFetched} pages fetched`);

  return { found, notFound, manualReview, diagnostics, debug: debugRows, status };
}
