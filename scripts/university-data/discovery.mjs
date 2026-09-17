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

import {
  htmlToText, pageTitle, headings, detectAcademicYear, mainContent, headingSections,
} from './extract.mjs';
import { safeFetch, isAllowedUrl, looksLikeChallenge, hostMatchesDomain, LIMITS } from './safety.mjs';

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
 * alternatives somewhere in the combined corpus.
 *
 * `coRequire` is stricter and exists because of a real false positive: MIT's
 * blog post "An Early History of International Students at MIT" satisfied
 * "international" and, somewhere else entirely on the page, "aid". Two concepts
 * present on one page are not a page about both. A coRequire pair must appear
 * in the SAME semantic region — the title, one heading section, or within a
 * few hundred characters of each other.
 *
 * `hardNegative` disqualifies outright. "Studying Old English at MIT" is not an
 * English proficiency requirement, at any score.
 *
 * `pdfPhrases` are the only signals strong enough to classify a PDF, which has
 * no readable body here. They are deliberately narrow.
 */
export const KIND_SIGNALS = {
  admissions: {
    decisionCritical: false,
    audienceSensitive: true,
    require: [['admission', 'admissions', 'apply', 'applying', 'application', 'applicants']],
    canonical: ['admissions', 'admission', 'apply', 'applying', 'undergraduate'],
    path: ['admissions', 'admission', 'apply', 'applying', 'first year', 'freshman'],
    title: ['admissions', 'admission', 'apply', 'application'],
    heading: ['how to apply', 'admissions', 'application', 'first year applicants'],
    text: ['how to apply', 'application process', 'first year applicants', 'apply for admission',
      'admissions office', 'application requirements', 'submit your application'],
    negative: ['graduate admissions', 'transfer credit policy'],
  },
  international_admissions: {
    decisionCritical: false,
    audienceSensitive: true,
    require: [
      ['international', 'overseas'],
      ['admission', 'admissions', 'apply', 'applying', 'applicant', 'applicants', 'application'],
    ],
    coRequire: [
      ['international', 'international students', 'international applicants', 'overseas'],
      ['admission', 'admissions', 'apply', 'applying', 'application', 'applicants', 'eligibility', 'requirements'],
    ],
    canonical: ['international', 'admissions', 'apply'],
    path: ['international', 'international students', 'international applicants'],
    title: ['international'],
    heading: ['international applicants', 'international students'],
    text: ['international applicants', 'international students', 'student visa', 'study permit',
      'if you are an international student'],
    negative: ['international news', 'global campus news'],
  },
  tuition: {
    decisionCritical: true,
    audienceSensitive: false,
    require: [['tuition', 'fees', 'fee']],
    canonical: ['tuition', 'fees', 'cost', 'afford', 'student financial services', 'bursar', 'registrar'],
    path: ['tuition', 'fees', 'tuition and fees', 'fee schedule'],
    title: ['tuition', 'fees'],
    heading: ['tuition', 'fees', 'tuition and fees'],
    text: ['tuition and fees', 'annual tuition', 'tuition rate', 'per academic year', 'tuition per year'],
    negative: [],
    pdfPhrases: ['tuition and fees', 'fee schedule', 'tuition fees'],
  },
  cost_of_attendance: {
    decisionCritical: true,
    audienceSensitive: false,
    require: [['cost', 'costs', 'budget', 'expenses']],
    canonical: ['cost', 'costs', 'cost of attendance', 'afford', 'tuition', 'financial aid', 'finaid'],
    path: ['cost of attendance', 'cost', 'budget', 'student budget', 'expenses'],
    title: ['cost of attendance', 'cost', 'budget'],
    heading: ['cost of attendance', 'estimated cost', 'student budget'],
    text: ['cost of attendance', 'estimated cost of attendance', 'student budget', 'total estimated cost'],
    negative: [],
    pdfPhrases: ['cost of attendance'],
  },
  financial_aid: {
    decisionCritical: true,
    audienceSensitive: false,
    require: [['aid', 'financial', 'funding', 'affordability', 'affording']],
    canonical: ['financial aid', 'finaid', 'aid', 'afford', 'student financial services', 'funding'],
    path: ['financial aid', 'finaid', 'aid', 'funding', 'affording', 'student financial services'],
    title: ['financial aid', 'aid', 'financial services', 'funding'],
    heading: ['financial aid', 'types of aid', 'applying for aid'],
    text: ['financial aid', 'need based', 'apply for financial aid', 'css profile', 'fafsa',
      'demonstrated need', 'aid package'],
    negative: ['first aid'],
  },
  international_financial_aid: {
    decisionCritical: true,
    audienceSensitive: false,
    require: [
      ['international', 'overseas', 'non citizens'],
      ['aid', 'financial', 'funding', 'scholarship', 'scholarships'],
    ],
    // The MIT false positive in one line: both ideas must be in the same place.
    coRequire: [
      ['international', 'international students', 'international applicants', 'international citizens', 'overseas', 'non citizens'],
      ['financial aid', 'need based aid', 'need based', 'scholarship', 'scholarships', 'aid package',
        'need blind', 'need aware', 'funding', 'demonstrated need', 'tuition free'],
    ],
    canonical: ['financial aid', 'finaid', 'aid', 'afford', 'international', 'funding'],
    path: ['international', 'international aid', 'aid for international students'],
    title: ['international'],
    heading: ['international students', 'aid for international students'],
    text: ['international students', 'aid for international', 'international applicants are eligible',
      'need blind for international', 'need aware for international'],
    negative: ['history of international students', 'international student office news'],
  },
  scholarships: {
    decisionCritical: false,
    audienceSensitive: false,
    require: [['scholarship', 'scholarships', 'award', 'awards', 'bursary', 'bursaries', 'merit']],
    canonical: ['scholarships', 'scholarship', 'awards', 'financial aid', 'finaid', 'afford'],
    path: ['scholarships', 'scholarship', 'awards', 'merit scholarships', 'bursaries'],
    title: ['scholarships', 'scholarship', 'awards'],
    heading: ['scholarships', 'merit scholarships', 'named scholarships'],
    text: ['scholarship', 'scholarships', 'merit based', 'award covers', 'full tuition scholarship'],
    negative: [],
  },
  testing_policy: {
    decisionCritical: true,
    audienceSensitive: true,
    require: [['sat', 'act', 'test', 'tests', 'testing', 'standardized', 'standardised']],
    coRequire: [
      ['sat', 'act', 'testing', 'standardized testing', 'standardised testing', 'test optional', 'test blind', 'tests'],
      ['require', 'required', 'requirement', 'requirements', 'policy', 'optional', 'submit', 'scores', 'applicants'],
    ],
    canonical: ['testing', 'tests', 'requirements', 'apply', 'admissions', 'standardized testing'],
    path: ['testing', 'standardized testing', 'test optional', 'sat act', 'tests', 'test policy', 'requirements'],
    title: ['testing', 'test', 'sat', 'act', 'test optional'],
    heading: ['testing policy', 'standardized testing', 'test optional', 'standardised testing', 'tests and scores'],
    text: ['test optional', 'test blind', 'sat or act', 'standardized testing', 'we require the sat',
      'testing policy', 'act scores'],
    negative: [],
    hardNegative: ['covid testing', 'coronavirus testing', 'drug testing', 'health testing', 'testing center hours'],
  },
  english_requirements: {
    decisionCritical: true,
    audienceSensitive: true,
    // "English" alone is never evidence. A proficiency term is mandatory.
    require: [
      ['english', 'language'],
      ['ielts', 'toefl', 'duolingo', 'proficiency', 'language requirement', 'language requirements'],
    ],
    coRequire: [
      ['english', 'english language', 'language'],
      ['proficiency', 'ielts', 'toefl', 'duolingo english test', 'duolingo', 'language requirement',
        'language requirements', 'minimum score', 'minimum overall band', 'language test'],
    ],
    canonical: ['english', 'requirements', 'admissions', 'apply', 'international', 'language'],
    path: ['english', 'english language requirements', 'english proficiency', 'language requirements'],
    title: ['english proficiency', 'english language', 'english language requirements', 'language requirements'],
    heading: ['english proficiency', 'english language requirement', 'english language requirements'],
    text: ['ielts', 'toefl', 'duolingo english test', 'english language proficiency', 'minimum overall band'],
    negative: [],
    hardNegative: ['old english', 'middle english', 'english literature', 'english department',
      'english major', 'creative writing', 'shakespeare'],
  },
  deadlines: {
    decisionCritical: true,
    audienceSensitive: true,
    require: [['deadline', 'deadlines', 'dates', 'timeline', 'calendar']],
    coRequire: [
      ['deadline', 'deadlines', 'dates', 'due'],
      ['application', 'apply', 'admissions', 'early action', 'early decision', 'regular decision', 'submit'],
    ],
    canonical: ['deadlines', 'dates', 'apply', 'admissions', 'requirements'],
    path: ['deadlines', 'dates', 'key dates', 'important dates', 'application deadlines'],
    title: ['deadlines', 'dates', 'deadline'],
    heading: ['deadlines', 'important dates', 'application dates', 'key dates'],
    text: ['application deadline', 'early action', 'early decision', 'regular decision',
      'deadlines', 'priority deadline'],
    negative: [],
    hardNegative: ['events calendar', 'academic calendar of events'],
  },
  programs: {
    decisionCritical: false,
    audienceSensitive: true,
    require: [['program', 'programs', 'programme', 'programmes', 'majors', 'academics', 'degrees', 'courses']],
    canonical: ['academics', 'programs', 'programmes', 'majors', 'degrees', 'fields of study', 'courses', 'catalog'],
    path: ['academics', 'programs', 'programmes', 'majors', 'degrees', 'fields of study', 'courses'],
    title: ['academics', 'programs', 'programmes', 'majors', 'degrees'],
    heading: ['undergraduate programs', 'majors', 'fields of study', 'degree programs'],
    text: ['majors', 'degree programs', 'fields of study', 'undergraduate programs', 'course catalog'],
    negative: [],
  },
  common_data_set: {
    decisionCritical: false,
    audienceSensitive: false,
    require: [['common data set', 'cds']],
    canonical: ['common data set', 'cds', 'institutional research', 'ir'],
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
  'sitemap', 'robots', 'privacy policy', 'terms of use', 'log in', 'login', 'sign in',
  'staff directory', 'directory', 'careers', 'jobs', 'search results', 'page not found', '404',
];

/* ------------------------------------------------------------------ */
/* Authority: is this the institution's page, or somebody writing about it */
/* ------------------------------------------------------------------ */

/**
 * Path segments that mark a standing institutional page.
 *
 * Generic on purpose. Nothing here names an institution, and nothing here came
 * from looking at one university's URL scheme.
 */
export const CANONICAL_SEGMENTS = [
  'apply', 'admissions', 'admission', 'afford', 'financial aid', 'finaid', 'aid', 'cost', 'costs',
  'tuition', 'fees', 'requirements', 'testing', 'tests', 'academics', 'majors', 'programs',
  'programmes', 'degrees', 'deadlines', 'dates', 'scholarships', 'scholarship', 'english',
  'undergraduate', 'admitted', 'prospective', 'bursar', 'registrar', 'student financial services',
  'institutional research', 'common data set',
];

/** Path segments that mark a dated article rather than a standing page. */
export const NON_CANONICAL_SEGMENTS = [
  'blogs', 'blog', 'news', 'stories', 'story', 'entry', 'entries', 'archive', 'archives',
  'posts', 'post', 'press', 'newsroom', 'announcements', 'announcement', 'events', 'event',
  'magazine', 'podcast', 'video', 'videos', 'author', 'authors', 'tag', 'tags', 'category',
  'categories', 'comment', 'comments',
];

/** Markers in the document body that identify an article, not a standing page. */
const BLOG_CONTENT_MARKERS = [
  'posted on', 'posted in', 'posted by', 'filed under', 'read more posts', 'leave a comment',
  'comments are closed', 'share this post', 'related posts', 'by the admissions blogger',
  'this entry was posted', 'continue reading',
];

/** Language that marks a page as announcing a change rather than stating policy. */
const ANNOUNCEMENT_MARKERS = [
  'we are reinstating', 'we are suspending', 'we are extending', 'we are pausing',
  'we have decided', 'we will no longer', 'we are no longer', 'starting in', 'beginning in',
  'effective for', 'effective from', 'we are announcing', 'we announced', 'as of today',
  'i am writing to share', 'we are excited to announce', 'today we are',
];

const AUTHORITY = {
  canonicalSegment: 2,
  canonicalCap: 4,
  kindCanonical: 2,
  // Moderate on purpose. Ranking is role-first, so a canonical page already
  // beats a blog whatever the scores say; these penalties only need to sink a
  // thin article below the acceptance bar while letting a genuinely detailed
  // one survive as fallback evidence.
  nonCanonicalFirst: -4,
  nonCanonicalExtra: -1,
  nonCanonicalCap: -6,
  blogContent: -2,
  dateInPath: -2,
};

/** Audience adjustment, for kinds where a first-year applicant is the default. */
const AUDIENCE_AUTHORITY = {
  first_year: 2,
  all_undergraduate: 1,
  international: 1,
  unknown: 0,
  transfer: -4,
  graduate: -7,
};
const AUDIENCE_RANK = {
  first_year: 5, all_undergraduate: 4, international: 4, unknown: 3, transfer: 1, graduate: 0,
};
const ROLE_RANK = { canonical: 3, supporting: 2, fallback: 1, historical: 0 };
const TEMPORAL_RANK = { current: 3, unknown: 2, dated: 1, historical: 0 };

const WEIGHTS = { title: 3, heading: 2, text: 1, path: 1, sitemap: 0.5, negative: -4 };
/** Body-text hits beyond this add nothing; a long page should not outrank a precise one. */
const TEXT_HIT_CAP = 4;
/** Below this a candidate is not classified at all. */
export const ACCEPT_THRESHOLD = 4;
/** The document must say something itself, not just have a suggestive URL. */
export const MIN_CONTENT_SIGNAL = 3;
/**
 * A blog or news page can only be the chosen source for a decision-critical
 * field if nothing better exists AND it is unusually strong. Precision beats
 * recall here: NOT FOUND is a better answer than a plausible wrong page.
 */
export const FALLBACK_MIN = 8;

const pathOf = (url) => {
  try { return new URL(url).pathname; } catch { return String(url ?? ''); }
};

/**
 * A path split into normalised directory segments.
 *
 * Authority is judged on whole segments, never on substrings. This matters:
 * `/news/admissions-office-moves-building` contains the word "admissions", but
 * "admissions" is not a segment of it — the segments are `news` and
 * `admissions office moves building`. Substring matching gave that news story a
 * +4 canonical bonus that cancelled out its -6 article penalty.
 */
export function pathSegments(url) {
  return pathOf(url).split('/').filter(Boolean).map((seg) => normalise(seg).trim()).filter(Boolean);
}

/** Terms that appear as a whole path segment. */
const segmentHits = (segments, terms) => {
  const set = new Set(segments);
  return terms.filter((t) => set.has(term(t)));
};

/* ------------------------------------------------------------------ */
/* Audience                                                            */
/* ------------------------------------------------------------------ */

/**
 * Who a page is written for.
 *
 * The product's default applicant is a first-year undergraduate, so a transfer
 * deadlines page answering as "the" deadlines source is a wrong answer, not a
 * partial one. Note that normalisation is word-shaped, so "undergraduate" does
 * not match the "graduate" term.
 */
export function detectAudience({ url = '', title = '', headingList = [] } = {}) {
  const hay = normalise(`${pathOf(url)} ${title} ${headingList.slice(0, 3).join(' ')}`);
  if (hits(hay, ['transfer', 'transfers', 'transferring', 'transfer applicants']).length) return 'transfer';
  if (hits(hay, ['graduate', 'grad', 'phd', 'doctoral', 'masters', 'mba', 'postgraduate']).length) return 'graduate';
  if (hits(hay, ['first year', 'first years', 'freshman', 'freshmen', 'first year applicants']).length) return 'first_year';
  if (hits(hay, ['undergraduate', 'undergraduates', 'undergrad']).length) return 'all_undergraduate';
  if (hits(hay, ['international', 'overseas']).length) return 'international';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* Temporal status                                                     */
/* ------------------------------------------------------------------ */

const isoDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** The academic year currently in progress, from a reference date. */
export function currentAcademicYear(now = new Date()) {
  const y = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 6 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** Publication and modification dates a page states about itself. */
export function pageDates(html = '', url = '') {
  const meta = (name) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'))?.[1]
    ?? null;

  const published =
    isoDate(meta('article:published_time')) ?? isoDate(meta('datePublished')) ??
    isoDate(meta('pubdate')) ?? isoDate(meta('date')) ?? isoDate(meta('DC.date')) ??
    isoDate(html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1]) ??
    isoDate(html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1]) ??
    isoDate(pathOf(url).match(/\/(20\d{2})\/(\d{2})(?:\/(\d{2}))?\//)?.slice(1).filter(Boolean).join('-'));

  const updated =
    isoDate(meta('article:modified_time')) ?? isoDate(meta('og:updated_time')) ??
    isoDate(meta('dateModified')) ??
    isoDate(html.match(/"dateModified"\s*:\s*"([^"]+)"/i)?.[1]) ??
    isoDate(html.match(/last\s+(?:updated|modified|reviewed)\s*:?\s*([A-Z][a-z]+ \d{1,2},? \d{4}|\d{4}-\d{2}-\d{2})/i)?.[1]);

  return { publishedDate: published, updatedDate: updated };
}

const monthsBetween = (a, b) => (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

/**
 * How current a page's statements are.
 *
 * `unknown` is the default and is not a failure: claiming a page is current
 * when nothing on it says so would be inventing the one property that matters
 * most for a policy that changes every cycle.
 */
export function detectTemporal({ html = '', url = '', text = '', blogLike = false } = {}, now = new Date()) {
  const { publishedDate, updatedDate } = pageDates(html, url);
  const year = detectAcademicYear(text || '');
  const hay = normalise(text);
  const announcement = hits(hay, ANNOUNCEMENT_MARKERS);
  const current = currentAcademicYear(now);

  const newest = updatedDate ?? publishedDate;
  const ageMonths = newest ? monthsBetween(new Date(newest), now) : null;

  let status = 'unknown';
  const why = [];

  if (year.year && year.year >= current) { status = 'current'; why.push(`states academic year ${year.year}`); }
  else if (ageMonths !== null && ageMonths <= 12 && !blogLike) { status = 'current'; why.push(`updated ${newest}`); }

  if (blogLike && announcement.length) {
    status = 'historical';
    why.push(`announces a change ("${announcement[0]}") rather than stating standing policy`);
  } else if (ageMonths !== null && ageMonths > 24) {
    status = 'historical'; why.push(`${newest} is over two years old`);
  } else if (status !== 'current' && ageMonths !== null && ageMonths > 12) {
    status = 'dated'; why.push(`${newest} is over a year old`);
  } else if (status !== 'current' && year.year && year.year < current) {
    status = 'dated'; why.push(`states academic year ${year.year}, current cycle is ${current}`);
  }

  return {
    publishedDate, updatedDate, academicYear: year.year,
    academicYearAmbiguous: year.ambiguous, temporalStatus: status, temporalReasons: why,
  };
}

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
 * Authority from the URL alone, computable before spending a request.
 *
 * This is what lets canonical-looking URLs be fetched before blog permalinks
 * instead of after the budget has run out.
 */
export function pathAuthority(rawUrl, kind) {
  const signals = KIND_SIGNALS[kind] ?? {};
  const path = pathOf(rawUrl);
  const reasons = [];
  let score = 0;

  const segments = pathSegments(rawUrl);
  const badHits = segmentHits(segments, NON_CANONICAL_SEGMENTS);
  const canonicalHits = segmentHits(segments, CANONICAL_SEGMENTS);
  const kindHits = segmentHits(segments, signals.canonical ?? []);

  // An article permalink earns no canonical credit, however many institutional
  // words its slug contains. A post filed under /news/ is a post.
  if (badHits.length === 0) {
    if (canonicalHits.length) {
      const bonus = Math.min(AUTHORITY.canonicalCap, canonicalHits.length * AUTHORITY.canonicalSegment);
      score += bonus;
      reasons.push(`canonical path (${canonicalHits.slice(0, 3).join(', ')}) +${bonus}`);
    }
    if (kindHits.length) {
      score += AUTHORITY.kindCanonical;
      reasons.push(`path matches this kind's canonical location (${kindHits[0]}) +${AUTHORITY.kindCanonical}`);
    }
  } else if (canonicalHits.length) {
    reasons.push(`canonical words (${canonicalHits.slice(0, 2).join(', ')}) ignored: this is an article path`);
  }

  if (badHits.length) {
    const penalty = Math.max(
      AUTHORITY.nonCanonicalCap,
      AUTHORITY.nonCanonicalFirst + (badHits.length - 1) * AUTHORITY.nonCanonicalExtra,
    );
    score += penalty;
    reasons.push(`article path (${badHits.join(', ')}) ${penalty}`);
  }
  if (/\/20\d{2}\//.test(path)) {
    score += AUTHORITY.dateInPath;
    reasons.push(`dated permalink ${AUTHORITY.dateInPath}`);
  }

  return {
    score, reasons, canonicalHits: badHits.length ? [] : canonicalHits, blogPath: badHits.length > 0,
  };
}

/**
 * Full authority score for a fetched document.
 *
 * Relevance answers "is this page about the topic". Authority answers "is this
 * the institution's standing statement on it, or somebody's post about it".
 * Both are needed: MIT's blog about reinstating the SAT requirement is highly
 * relevant to testing policy and is not the testing policy.
 */
export function scoreAuthority(kind, doc = {}, now = new Date()) {
  const { url = '', title = '', headingList = [], text = '', html = '' } = doc;
  const p = pathAuthority(url, kind);
  const reasons = [...p.reasons];
  let score = p.score;

  const blogMarkers = hits(normalise(text), BLOG_CONTENT_MARKERS);
  if (blogMarkers.length) {
    score += AUTHORITY.blogContent;
    reasons.push(`article markers in the body ("${blogMarkers[0]}") ${AUTHORITY.blogContent}`);
  }
  const blogLike = p.blogPath || blogMarkers.length > 0;

  const audience = doc.audience ?? detectAudience({ url, title, headingList });
  const signals = KIND_SIGNALS[kind] ?? {};
  if (signals.audienceSensitive) {
    const adj = AUDIENCE_AUTHORITY[audience] ?? 0;
    if (adj !== 0) {
      score += adj;
      reasons.push(`audience ${audience} ${adj > 0 ? '+' : ''}${adj}`);
    }
  }

  const temporal = doc.temporal ?? detectTemporal({ html, url, text, blogLike }, now);

  const role =
    blogLike && temporal.temporalStatus === 'historical' ? 'historical'
    : blogLike ? 'fallback'
    : p.canonicalHits.length > 0 ? 'canonical'
    : 'supporting';

  return { score: Number(score.toFixed(2)), reasons, role, blogLike, audience, temporal };
}

/**
 * True when two concept groups appear in the same semantic region.
 *
 * Regions are the title, each heading section, and a sliding window over the
 * body. "International students" in the page header and "financial aid" in the
 * footer is not international financial aid.
 */
export function coOccurs(groupA, groupB, { title = '', sections = [], text = '', windowChars = 300 } = {}) {
  const inBoth = (hay) => {
    const a = hits(hay, groupA);
    const b = hits(hay, groupB);
    return a.length && b.length ? { a: a[0], b: b[0] } : null;
  };

  const t = inBoth(normalise(title));
  if (t) return { ok: true, where: 'title', excerpt: title.slice(0, 200), matched: t };

  for (const section of sections) {
    const hay = normalise(`${section.heading ?? ''} ${section.body ?? ''}`);
    const m = inBoth(hay);
    if (m) {
      return {
        ok: true, where: 'heading section',
        excerpt: `${section.heading ?? ''} — ${(section.body ?? '').slice(0, 160)}`.trim(),
        matched: m,
      };
    }
  }

  // Sliding window, so a single paragraph counts even on a page with no
  // headings. It runs *inside* each section rather than across the whole
  // document: a window that spans a section boundary would undo the check
  // above, which is how "international students" in one section and
  // "scholarship fund" in the next nearly passed as international aid.
  const scopes = sections.length
    ? sections.map((section) => String(section.body ?? ''))
    : [String(text)];

  for (const scope of scopes) {
    const body = scope.slice(0, 200_000);
    for (let i = 0; i < Math.max(body.length, 1); i += Math.floor(windowChars / 2)) {
      const slice = body.slice(i, i + windowChars);
      const m = inBoth(normalise(slice));
      if (m) return { ok: true, where: 'nearby text', excerpt: slice.slice(0, 200), matched: m };
    }
  }

  return { ok: false, where: null, excerpt: null, matched: null };
}

/**
 * Scores one fetched document against one kind.
 *
 * `content` is the part that comes from the document itself. A candidate with
 * `content` below MIN_CONTENT_SIGNAL is never accepted, no matter how
 * suggestive its URL is.
 */
export function scoreKind(kind, doc = {}, now = new Date()) {
  const signals = KIND_SIGNALS[kind];
  if (!signals) return { kind, score: 0, content: 0, accepted: false, reasons: ['unknown kind'] };

  const { url = '', title = '', headingList = [], text = '', sitemapContext = '' } = doc;
  const sections = doc.sections ?? (text ? [{ heading: headingList[0] ?? '', body: text }] : []);

  const hayTitle = normalise(title);
  const hayHeadings = normalise(headingList.join(' . '));
  const hayText = normalise(text.slice(0, 200_000));
  const hayPath = normalise(pathOf(url));
  const hayContext = normalise(sitemapContext);
  const corpus = `${hayTitle}${hayHeadings}${hayText}${hayPath}`;

  const fail = (reason) => ({
    kind, score: 0, relevance: 0, authority: 0, content: 0, accepted: false, reasons: [reason],
    role: 'fallback', audience: 'unknown', temporal: { temporalStatus: 'unknown' },
  });

  const hard = hits(corpus, signals.hardNegative ?? []);
  if (hard.length) return fail(`disqualified: "${hard[0]}" is not this kind of page`);

  for (const group of signals.require ?? []) {
    if (!group.some((t) => hasTerm(corpus, t))) {
      return fail(`missing required term (${group.slice(0, 3).join('/')})`);
    }
  }

  let coOccurrence = null;
  if (signals.coRequire) {
    coOccurrence = coOccurs(signals.coRequire[0], signals.coRequire[1], { title, sections, text });
    if (!coOccurrence.ok) {
      return fail(
        `both concepts appear but never together — "${signals.coRequire[0][0]}" and `
        + `"${signals.coRequire[1][0]}" are never in the same title, section or paragraph`,
      );
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

  const relevance =
    content +
    weigh(pathHits) * WEIGHTS.path +
    weigh(contextHits) * WEIGHTS.sitemap +
    negatives.length * WEIGHTS.negative;

  const auth = scoreAuthority(kind, doc, now);
  const score = relevance + auth.score;

  const reasons = [];
  if (titleHits.length) reasons.push(`title: ${titleHits.join(', ')}`);
  if (headingHits.length) reasons.push(`headings: ${headingHits.join(', ')}`);
  if (textHits.length) reasons.push(`body: ${textHits.slice(0, TEXT_HIT_CAP).join(', ')}`);
  if (pathHits.length) reasons.push(`path: ${pathHits.join(', ')}`);
  if (contextHits.length) reasons.push(`sitemap context: ${contextHits.join(', ')}`);
  if (coOccurrence?.ok) reasons.push(`both concepts in the ${coOccurrence.where}`);
  if (negatives.length) reasons.push(`negative: ${negatives.join(', ')}`);
  reasons.push(...auth.reasons);

  const accepted = content >= MIN_CONTENT_SIGNAL && score >= ACCEPT_THRESHOLD;
  if (!accepted && content < MIN_CONTENT_SIGNAL) {
    reasons.push('no signal in the document itself — URL alone never classifies');
  } else if (!accepted) {
    reasons.push(`final score ${score.toFixed(2)} below the ${ACCEPT_THRESHOLD} threshold`);
  }

  return {
    kind,
    score: Number(score.toFixed(2)),
    relevance: Number(relevance.toFixed(2)),
    authority: auth.score,
    content,
    accepted,
    role: auth.role,
    audience: auth.audience,
    temporal: auth.temporal,
    coOccurrence,
    reasons,
  };
}

/** Scores a document against every kind; a page may legitimately serve several. */
export function classifyDocument(doc, now = new Date()) {
  return Object.keys(KIND_SIGNALS)
    .map((kind) => scoreKind(kind, doc, now))
    .sort((a, b) => b.score - a.score);
}

/**
 * Orders two accepted candidates for the same kind.
 *
 * Role first, deliberately: a canonical page wins over a blog post even with a
 * lower keyword score, which is the whole point of separating authority from
 * relevance. Then audience, then how current the page is, then score.
 */
export function compareCandidates(a, b) {
  return (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0)
    || (AUDIENCE_RANK[b.audience] ?? 3) - (AUDIENCE_RANK[a.audience] ?? 3)
    || (TEMPORAL_RANK[b.temporal?.temporalStatus] ?? 2) - (TEMPORAL_RANK[a.temporal?.temporalStatus] ?? 2)
    || b.score - a.score;
}

/** Why the winner beat the runner-up, in one line. */
export function whyItWon(winner, loser) {
  if (!loser) return 'no other candidate qualified';
  if ((ROLE_RANK[winner.role] ?? 0) !== (ROLE_RANK[loser.role] ?? 0)) {
    return `${winner.role} source outranks ${loser.role}`;
  }
  if ((AUDIENCE_RANK[winner.audience] ?? 3) !== (AUDIENCE_RANK[loser.audience] ?? 3)) {
    return `audience ${winner.audience} is preferred over ${loser.audience}`;
  }
  const wt = winner.temporal?.temporalStatus ?? 'unknown';
  const lt = loser.temporal?.temporalStatus ?? 'unknown';
  if (wt !== lt) return `${wt} policy preferred over ${lt}`;
  return `higher final score (${winner.score} vs ${loser.score})`;
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
export function classifyPdf({ url, title }, now = new Date()) {
  const out = [];
  for (const [kind, signals] of Object.entries(KIND_SIGNALS)) {
    if (title) {
      const s = scoreKind(kind, { url, title, headingList: [], text: title }, now);
      if (s.accepted) { out.push({ ...s, contentSignal: 'pdf-metadata-title' }); continue; }
    }
    const phrases = signals.pdfPhrases ?? [];
    if (!phrases.length) continue;
    const matched = hits(normalise(pathOf(url)), phrases);
    if (matched.length) {
      const auth = pathAuthority(url, kind);
      out.push({
        kind, score: weigh(matched) * WEIGHTS.title + auth.score, relevance: weigh(matched) * WEIGHTS.title,
        authority: auth.score, content: 0, accepted: true,
        contentSignal: 'pdf-filename-phrase',
        role: auth.blogPath ? 'fallback' : 'canonical',
        audience: 'unknown',
        temporal: { temporalStatus: 'unknown', publishedDate: null, updatedDate: null, academicYear: null },
        reasons: [`filename phrase: ${matched.join(', ')}`, ...auth.reasons],
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

/** Candidate tiers. A URL the site publishes always beats a path we guessed. */
const TIER = { discovered: 0, guess: 1 };

const lastSegment = (url) => {
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''; } catch { return ''; }
};

/**
 * How worthwhile a candidate looks before a request is spent on it.
 *
 * Purely URL-based, and that is the point. A live run exhausted its budget on
 * blog permalinks before the standing pages were reached, so ordering has to
 * happen off-network. Canonical-looking URLs are fetched first; article
 * permalinks are fetched last, if at all.
 */
export function candidatePriority(url, kind) {
  const rel = scoreUrlPath(url, kind).score;
  const auth = pathAuthority(url, kind);
  const signals = KIND_SIGNALS[kind] ?? {};
  const audience = detectAudience({ url });
  const audienceAdj = signals.audienceSensitive ? (AUDIENCE_AUTHORITY[audience] ?? 0) : 0;
  return {
    score: Number((rel + auth.score + audienceAdj).toFixed(2)),
    relevance: rel, authority: auth.score, audience, blogPath: auth.blogPath,
  };
}

/**
 * Hosts an already-trusted page links to that may be the same institution.
 *
 * Never auto-trusted. This only produces a list for a human to look at, because
 * "a trusted page linked to it" is not the same as "the institution owns it" —
 * official pages link to payment processors, testing agencies and social media
 * too. The heuristic is deliberately narrow: the host must share a name token
 * with the institution or with a domain already approved for it.
 */
export function collectDomainCandidates(html, { allowedDomains, nameTokens }) {
  const out = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*href=["'](https:\/\/[^"'#?]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let host;
    try { host = new URL(m[1]).hostname.toLowerCase(); } catch { continue; }
    if (allowedDomains.some((d) => hostMatchesDomain(host, d))) continue;

    const labels = host.split('.');
    const related = nameTokens.some((t) => t.length >= 3 && labels.some((l) => l.includes(t)));
    if (!related) continue;

    const prev = out.get(host) ?? { host, occurrences: 0, examples: [], anchors: [] };
    prev.occurrences++;
    if (prev.examples.length < 3) prev.examples.push(m[1]);
    const anchor = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (anchor && prev.anchors.length < 3) prev.anchors.push(anchor.slice(0, 80));
    out.set(host, prev);
  }
  return [...out.values()];
}

/** Name tokens for the domain-candidate heuristic, from the registry entry only. */
function institutionTokens(entry) {
  const words = normalise(`${entry.officialName ?? ''} ${entry.shortName ?? ''}`).trim().split(' ');
  const stop = new Set(['the', 'of', 'and', 'for', 'university', 'institute', 'college', 'school', 'technology', 'national', 'state']);
  const tokens = words.filter((w) => w.length >= 3 && !stop.has(w));
  // The registrable label of each approved domain is the strongest token we have.
  for (const d of entry.allowedDomains ?? []) tokens.push(d.split('.')[0]);
  const acronym = (entry.shortName ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (acronym.length >= 2) tokens.push(acronym);
  return [...new Set(tokens)];
}

/**
 * Discovers official pages for one institution.
 *
 * Bounded and deterministic: robots.txt -> sitemaps (recursing into indexes) ->
 * priority-ordered candidates -> fetch -> classify by content -> pick the most
 * authoritative source per kind. There is no link-following crawl, and every
 * URL at every stage is re-checked against the institution's allow-list.
 */
export async function discoverPages(entry, {
  fetchImpl = safeFetch,
  log = () => {},
  debug = false,
  limits = DISCOVERY_LIMITS,
  maxRequests = LIMITS.maxPagesPerDomain,
  now = new Date(),
} = {}) {
  const domains = entry.allowedDomains;
  const kinds = Object.keys(KIND_SIGNALS);
  const nameTokens = institutionTokens(entry);
  /** Every accepted candidate per kind, so a winner can be chosen and explained. */
  const perKind = Object.fromEntries(kinds.map((k) => [k, []]));
  const debugRows = [];
  const manualReview = [];
  const domainCandidates = new Map();
  const diagnostics = {
    robotsSitemaps: [], sitemapsFetched: 0, sitemapUrlsDiscovered: 0,
    nonContentUrlsSkipped: 0, candidatesConsidered: 0, candidatesSkippedForBudget: 0,
    pagesFetched: 0, pagesClassified: 0, chromeStrippedPages: 0, requests: 0,
    budgetExhausted: false,
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
    for (const sm of parseRobotsSitemaps(robots.text)) {
      if (isAllowedUrl(sm, domains).ok) {
        diagnostics.robotsSitemaps.push(sm);
        sitemapQueue.push({ url: sm, depth: 0, context: lastSegment(sm) });
      } else {
        note({ url: sm, stage: 'robots', decision: 'skipped', reason: 'sitemap outside the allow-list' });
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

  /* ---- 4. rank candidates by priority, per kind ---- */
  /** @type {Map<string,{url:string,context:string,priority:number,kinds:string[],why:string[]}>} */
  const candidates = new Map();
  const consider = (url, context, kind, priority, tier) => {
    const nc = isNonContentUrl(url);
    if (nc.nonContent) {
      diagnostics.nonContentUrlsSkipped++;
      note({ url, stage: 'candidate', decision: 'rejected', reason: nc.reason });
      return;
    }
    if (!isAllowedUrl(url, domains).ok) return;
    const prev = candidates.get(url);
    if (prev) {
      prev.priority = Math.max(prev.priority, priority.score);
      prev.tier = Math.min(prev.tier, tier);
      if (!prev.kinds.includes(kind)) prev.kinds.push(kind);
      return;
    }
    candidates.set(url, {
      url, context, priority: priority.score, tier, kinds: [kind],
      why: [`${kind}: relevance ${priority.relevance}, authority ${priority.authority}${priority.blogPath ? ', article path' : ''}`],
    });
  };

  const discovered = [...contentUrls.values()];
  for (const kind of kinds) {
    const ranked = discovered
      .map((cand) => ({ ...cand, p: candidatePriority(cand.url, kind) }))
      .filter((cand) => cand.p.relevance > 0)
      .sort((a, b) => b.p.score - a.p.score || a.url.length - b.url.length)
      .slice(0, limits.maxCandidatesPerKind);
    for (const cand of ranked) consider(cand.url, cand.context, kind, cand.p, TIER.discovered);

    // Conventional guesses are a separate, lower tier. They mostly 404, and a
    // guess that looks canonical used to outrank a URL the site actually
    // publishes — which is how a live run spent 45 requests on 404s and never
    // reached the pages in its own sitemap.
    const strong = ranked.filter((cand) => cand.p.score >= 2).length;
    if (strong >= 3) continue;
    for (const guess of CANDIDATE_PATHS[kind] ?? []) {
      const url = new URL(guess, entry.officialRootUrl).toString();
      consider(url, 'conventional-path', kind, candidatePriority(url, kind), TIER.guess);
    }
  }
  diagnostics.candidatesConsidered = candidates.size;

  /* ---- 5. fetch and classify, most promising first ---- */
  // Tier first, then priority: everything the site actually publishes is tried
  // before any guess, and within each tier canonical-looking URLs go first.
  const ordered = [...candidates.values()].sort((a, b) => a.tier - b.tier || b.priority - a.priority);
  const retrievedAt = new Date().toISOString();

  for (const cand of ordered) {
    if (diagnostics.pagesFetched >= limits.maxContentFetches || !budgetLeft()) {
      diagnostics.budgetExhausted = true;
      diagnostics.candidatesSkippedForBudget++;
      continue;
    }

    const res = await fetchOnce(cand.url);
    diagnostics.pagesFetched++;
    if (!res.ok) {
      note({ url: cand.url, stage: 'fetch', status: res.status, decision: 'rejected', reason: res.reason, priority: cand.priority });
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
    const isHtml = res.contentType === 'text/html' || res.contentType === 'application/xhtml+xml'
      || res.contentType === 'text/plain' || !res.contentType;
    if (!isPdf && !isHtml) {
      note({ url: res.url, stage: 'classify', status: res.status, contentType: res.contentType, decision: 'rejected', reason: `${res.contentType} is not a readable page` });
      continue;
    }

    let scored;
    let title = null;
    let doc = null;

    if (isPdf) {
      title = pdfTitle(res.body);
      scored = classifyPdf({ url: res.url, title }, now);
      const year = detectAcademicYear(`${title ?? ''} ${lastSegment(res.url)}`).year;
      for (const sc of scored) sc.temporal = { ...sc.temporal, academicYear: year };
      if (scored.length === 0) {
        manualReview.push({
          url: res.url, title, retrievedAt, contentType: res.contentType,
          reason: 'official PDF found, but nothing in the document itself identifies its subject — read it manually',
        });
        note({ url: res.url, stage: 'classify', status: res.status, contentType: res.contentType, decision: 'manual-review', reason: 'PDF without an identifying title' });
        continue;
      }
    } else {
      const rawHtml = res.text ?? '';
      title = pageTitle(rawHtml) ?? '';
      // Classify from the page, not from the template it shares with every
      // other page on the site.
      const main = mainContent(rawHtml);
      if (main.stripped || main.usedMain) diagnostics.chromeStrippedPages++;
      doc = {
        url: res.url, title, html: rawHtml,
        headingList: headings(main.html),
        text: htmlToText(main.html),
        sections: headingSections(main.html),
        sitemapContext: cand.context,
      };
      scored = classifyDocument(doc, now);

      for (const dc of collectDomainCandidates(rawHtml, { allowedDomains: domains, nameTokens })) {
        const prev = domainCandidates.get(dc.host);
        if (prev) { prev.occurrences += dc.occurrences; continue; }
        domainCandidates.set(dc.host, { ...dc, linkedFrom: res.url });
      }
    }
    diagnostics.pagesClassified++;

    const accepted = scored.filter((sc) => sc.accepted);
    note({
      url: res.url, stage: 'classify', status: res.status, contentType: res.contentType,
      title, priority: cand.priority,
      decision: accepted.length ? 'accepted' : 'rejected',
      scores: scored.slice(0, 4).map((sc) => `${sc.kind}=${sc.score}(rel ${sc.relevance ?? '—'}/auth ${sc.authority ?? '—'})`),
      role: scored[0]?.role, audience: scored[0]?.audience,
      temporalStatus: scored[0]?.temporal?.temporalStatus,
      reason: accepted.length
        ? accepted.map((sc) => `${sc.kind}: ${sc.reasons.join('; ')}`).join(' | ')
        : scored[0]?.reasons.join('; ') ?? 'no kind matched',
    });

    // One page may support several kinds; each is recorded independently.
    for (const sc of accepted) {
      perKind[sc.kind].push({
        url: res.url, title: title || null, contentType: res.contentType,
        retrievedAt, discoveredVia: cand.context === 'conventional-path' ? 'conventional-path' : `sitemap:${cand.context}`,
        contentSignal: sc.contentSignal ?? 'html-content',
        requiresManualReading: isPdf,
        score: sc.score, relevanceScore: sc.relevance ?? sc.score, authorityScore: sc.authority ?? 0,
        sourceRole: sc.role, audience: sc.audience, temporal: sc.temporal,
        academicYear: sc.temporal?.academicYear ?? null,
        reasons: sc.reasons, role: sc.role,
      });
    }
  }

  /* ---- 6. choose the most authoritative source per kind ---- */
  const found = {};
  const rejectedForQuality = [];
  const fallbacks = {};

  for (const kind of kinds) {
    const list = [...perKind[kind]].sort(compareCandidates);
    if (list.length === 0) continue;
    const [winner, runnerUp] = list;

    if (KIND_SIGNALS[kind].decisionCritical) {
      // Precision over recall. A page announcing that a policy changed is not
      // the policy, at any score — that is what made MIT's "we are reinstating
      // our SAT/ACT requirement" post look like a testing policy source. A blog
      // that merely discusses the topic can stand in, but only when nothing
      // canonical exists and only if it is unusually strong.
      const reason =
        winner.sourceRole === 'historical'
          ? 'the only source found announces a change in policy rather than stating the current one'
          : winner.sourceRole === 'fallback' && winner.score < FALLBACK_MIN
            ? `only a fallback source was found for a decision-critical field, and ${winner.score} is below the ${FALLBACK_MIN} bar for one`
            : null;
      if (reason) {
        fallbacks[kind] = winner;
        rejectedForQuality.push({ kind, url: winner.url, role: winner.sourceRole, score: winner.score, reason });
        continue;
      }
    }

    found[kind] = {
      ...winner,
      temporalStatus: winner.temporal?.temporalStatus ?? 'unknown',
      publishedDate: winner.temporal?.publishedDate ?? null,
      updatedDate: winner.temporal?.updatedDate ?? null,
      whySelected: winner.reasons.slice(0, 4).join('; '),
      runnerUp: runnerUp
        ? { url: runnerUp.url, score: runnerUp.score, role: runnerUp.sourceRole, audience: runnerUp.audience, whyItLost: whyItWon(winner, runnerUp) }
        : null,
      alternatives: list.length - 1,
    };
  }

  const notFound = kinds.filter((k) => !found[k]);
  const status = Object.keys(found).length === kinds.length ? 'complete'
    : Object.keys(found).length > 0 ? 'partial'
    : 'failed';

  log(`  discovery: ${Object.keys(found).length}/${kinds.length} page kinds found`);
  log(`    ${diagnostics.requests} requests · ${diagnostics.sitemapsFetched} sitemaps · ${diagnostics.sitemapUrlsDiscovered} sitemap URLs · ${diagnostics.candidatesConsidered} candidates · ${diagnostics.pagesFetched} pages fetched`);

  return {
    found, notFound, manualReview, rejectedForQuality, fallbacks,
    domainCandidates: [...domainCandidates.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, 10),
    diagnostics, debug: debugRows, status,
  };
}
