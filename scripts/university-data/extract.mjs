/**
 * Deterministic field extraction.
 *
 * Everything here is regex and table parsing over text that was fetched from an
 * allow-listed official domain. There is no model in this file and no guessing:
 * an extractor either finds an unambiguous pattern and returns it with the
 * excerpt it came from, or it returns nothing.
 *
 * Every extractor returns candidates, never final values. A candidate becomes
 * data only after validation and human approval.
 */

/* ------------------------------------------------------------------ */
/* Text preparation                                                    */
/* ------------------------------------------------------------------ */

/** Strips tags and collapses whitespace; keeps enough structure for context. */
export function htmlToText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ */
/* Main content vs site chrome                                         */
/* ------------------------------------------------------------------ */

/**
 * Container tags whose contents are site furniture rather than the page.
 *
 * This matters more than it looks. A live run over MIT gave almost every page
 * an admissions score of 7-8.5, because the global navigation on every page
 * contains "how to apply", "first year applicants" and "admissions office". A
 * classifier reading whole-page text is really reading the template.
 */
const CHROME_TAGS = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'svg', 'form', 'iframe', 'template', 'dialog'];

/** class/id fragments that mark a block as furniture on essentially every CMS. */
const CHROME_ATTR =
  /(?:class|id)\s*=\s*["'][^"']*(?:^|[\s_-])(nav|navbar|navigation|menu|masthead|header|footer|sidebar|side-bar|breadcrumb|cookie|consent|banner|related|related-posts|share|sharing|social|widget|promo|cta|skip|skip-link|site-search|searchform|subscribe|newsletter|comment|comments|pagination|pager|toolbar|utility|global|offcanvas|drawer|megamenu|site-info|colophon)(?:[\s_-]|["'])/i;

const CONTAINER_TAGS = ['div', 'section', 'ul', 'ol', 'aside', 'table'];

/** Index just past the close tag matching the element opening at `start`. */
function matchingClose(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(html)); ) {
    if (m[1] === '/') {
      depth--;
      if (depth <= 0) return m.index + m[0].length;
    } else if (!/\/>\s*$/.test(m[0])) {
      depth++;
    }
  }
  return -1;
}

/** Removes every element with the given tag name, nesting included. */
function removeElements(html, tag) {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  let out = html;
  for (let guard = 0; guard < 200; guard++) {
    const m = out.match(open);
    if (!m || m.index === undefined) break;
    const end = matchingClose(out, m.index, tag);
    // An unclosed tag is a malformed page, not a licence to delete the rest of
    // it: drop the tag itself and carry on.
    out = end === -1
      ? out.slice(0, m.index) + ' ' + out.slice(m.index + m[0].length)
      : out.slice(0, m.index) + ' ' + out.slice(end);
  }
  return out;
}

/** Removes container elements whose class or id marks them as chrome. */
function removeChromeContainers(html) {
  let out = html;
  for (let guard = 0; guard < 300; guard++) {
    const re = new RegExp(`<(${CONTAINER_TAGS.join('|')})\\b[^>]*>`, 'gi');
    let cut = null;
    for (let m; (m = re.exec(out)); ) {
      if (!CHROME_ATTR.test(m[0])) continue;
      const end = matchingClose(out, m.index, m[1]);
      cut = { start: m.index, end: end === -1 ? m.index + m[0].length : end };
      break;
    }
    if (!cut) break;
    out = out.slice(0, cut.start) + ' ' + out.slice(cut.end);
  }
  return out;
}

/** The first element with this tag, contents included. */
function firstElement(html, tag) {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'i'));
  if (!m || m.index === undefined) return null;
  const end = matchingClose(html, m.index, tag);
  return end === -1 ? null : html.slice(m.index, end);
}

/**
 * Narrows a page to the content it is actually about.
 *
 * Strips furniture, then prefers <main> or <article> when the page marks one.
 * `usedMain` records whether that landmark existed, because a page with no
 * landmark and no strippable chrome may still be mostly template — the caller
 * should know which it got rather than assume.
 */
export function mainContent(html) {
  if (!html) return { html: '', usedMain: false, stripped: false };
  let h = html;
  for (const tag of CHROME_TAGS) h = removeElements(h, tag);
  const beforeChrome = h.length;
  h = removeChromeContainers(h);
  const landmark = firstElement(h, 'main') ?? firstElement(h, 'article');
  return {
    html: landmark ?? h,
    usedMain: Boolean(landmark),
    stripped: h.length < beforeChrome || h.length < html.length,
  };
}

/**
 * Splits a document into heading-scoped sections.
 *
 * Used for co-occurrence: "international students" in one section and
 * "financial aid" in another is not a page about aid for international
 * students, however close the two are in the raw text.
 */
export function headingSections(html) {
  if (!html) return [];
  const out = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let last = 0;
  let heading = '';
  for (let m; (m = re.exec(html)); ) {
    const body = htmlToText(html.slice(last, m.index));
    if (heading || body) out.push({ heading, body });
    heading = htmlToText(m[2]).trim();
    last = m.index + m[0].length;
  }
  const tail = htmlToText(html.slice(last));
  if (heading || tail) out.push({ heading, body: tail });
  return out.filter((s) => s.heading || s.body);
}

export function pageTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? null;
}

export function headings(html) {
  return [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => htmlToText(m[2]).trim())
    .filter(Boolean)
    .slice(0, 40);
}

/** Extracts HTML tables as arrays of rows, which is where fee schedules live. */
export function tables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => htmlToText(c[1]).trim()),
    ),
  );
}

/** Context window around a match, used as the evidence excerpt. */
function excerptAround(text, index, length, pad = 110) {
  return text
    .slice(Math.max(0, index - pad), Math.min(text.length, index + length + pad))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The sentence containing a match.
 *
 * Qualifiers must be read from the sentence that owns the figure, never from a
 * fixed character window. A page reading "tuition is $66,720 per year. Housing
 * is $1,200 per month." would otherwise let "per month" contaminate the tuition
 * figure — and the same mistake in reverse would let a monthly figure pass as
 * annual, which understates cost of attendance roughly twelvefold.
 */
function sentenceAround(text, index, length) {
  const before = text.lastIndexOf('.', index);
  const newlineBefore = text.lastIndexOf('\n', index);
  const start = Math.max(before, newlineBefore) + 1;

  const after = text.indexOf('.', index + length);
  const newlineAfter = text.indexOf('\n', index + length);
  const candidates = [after, newlineAfter].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) + 1 : text.length;

  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Academic year                                                       */
/* ------------------------------------------------------------------ */

/**
 * Finds the academic year a figure belongs to.
 *
 * A page that lists several years is the dangerous case — a parser that takes
 * the first match can silently return a 2023 fee. When more than one distinct
 * year appears we return `ambiguous`, which forces review.
 */
export function detectAcademicYear(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(20\d{2})\s*[-–/]\s*(\d{2}|20\d{2})\b/g)) {
    const start = m[1];
    const endRaw = m[2];
    const end = endRaw.length === 4 ? endRaw.slice(2) : endRaw;
    // Only consecutive years are academic years; "2020-2024" is a range, not one.
    if ((Number(start.slice(2)) + 1) % 100 === Number(end)) found.add(`${start}-${end}`);
  }
  const years = [...found].sort();
  if (years.length === 0) return { year: null, ambiguous: false, candidates: [] };
  if (years.length === 1) return { year: years[0], ambiguous: false, candidates: years };
  return { year: years[years.length - 1], ambiguous: true, candidates: years };
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

const CURRENCY_SYMBOLS = {
  '$': 'USD', 'US$': 'USD', 'USD': 'USD',
  '£': 'GBP', 'GBP': 'GBP',
  '€': 'EUR', 'EUR': 'EUR',
  'HK$': 'HKD', 'HKD': 'HKD',
  'S$': 'SGD', 'SGD': 'SGD',
  '¥': 'JPY', 'JPY': 'JPY',
  '₩': 'KRW', 'KRW': 'KRW',
  'CHF': 'CHF', 'CZK': 'CZK', 'PLN': 'PLN', 'KZT': 'KZT', 'AED': 'AED',
};

/** Per-unit wording that means a figure is NOT an annual total. */
const PER_UNIT_PATTERNS = [
  { re: /\bper\s+(credit|credit[- ]hour|unit|course|module)\b/i, unit: 'per-credit' },
  { re: /\bper\s+(semester|term|trimester)\b/i, unit: 'per-semester' },
  { re: /\bper\s+(month|monthly)\b/i, unit: 'per-month' },
  { re: /\bper\s+(week|weekly)\b/i, unit: 'per-week' },
  { re: /\bper\s+(quarter)\b/i, unit: 'per-quarter' },
];

/**
 * Extracts monetary figures with their currency and per-unit qualifier.
 *
 * The per-unit detection is the point of this function. A housing figure quoted
 * monthly, read as annual, understates cost of attendance by roughly 12x — and
 * it would look entirely plausible in the UI. Anything not explicitly annual is
 * flagged so validation can refuse it.
 */
export function extractMoney(text) {
  const out = [];
  const re = /(US\$|HK\$|S\$|[$£€¥₩])\s?([\d][\d,\s]{0,14}(?:\.\d{1,2})?)|(\b\d[\d,]{2,14}(?:\.\d{1,2})?)\s?(USD|GBP|EUR|HKD|SGD|JPY|KRW|CHF|CZK|PLN|KZT|AED)\b/g;

  for (const m of text.matchAll(re)) {
    const symbol = m[1] ?? m[4];
    const raw = (m[2] ?? m[3] ?? '').replace(/[,\s]/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;

    // Qualifiers come from the owning sentence; the excerpt may be wider.
    const sentence = sentenceAround(text, m.index, m[0].length);
    const context = excerptAround(text, m.index, m[0].length, 140);
    const perUnit = PER_UNIT_PATTERNS.find((p) => p.re.test(sentence));
    const annual = /\b(per\s+(year|annum)|annual(ly)?|\/\s*year|a year|per academic year)\b/i.test(sentence);

    out.push({
      value,
      currency: CURRENCY_SYMBOLS[symbol] ?? null,
      unit: perUnit ? perUnit.unit : annual ? 'per-year' : 'unqualified',
      isAnnual: Boolean(annual) && !perUnit,
      excerpt: context,
      sentence,
      index: m.index,
    });
  }
  return out;
}

/** Narrows money candidates to those whose context mentions a given concept. */
export function moneyNear(text, keywords) {
  const re = new RegExp(`\\b(${keywords.join('|')})\\b`, 'i');
  return extractMoney(text).filter((m) => re.test(m.sentence ?? m.excerpt));
}

/* ------------------------------------------------------------------ */
/* English proficiency                                                 */
/* ------------------------------------------------------------------ */

/**
 * Extracts an IELTS overall minimum.
 *
 * Distinguishing the overall band from a per-section minimum matters: a page
 * reading "6.5 overall with no band below 6.0" contains both, and taking the
 * lower one understates the requirement. Section minimums are returned
 * separately rather than silently discarded.
 */
export function extractIELTS(text) {
  const results = [];
  // Matches a score on either side of the word IELTS: pages write both
  // "IELTS 6.5 overall" and "a minimum of 6.0 in each IELTS component".
  const re = /IELTS[^.\n]{0,120}?(\d(?:\.\d)?)|(\d(?:\.\d)?)[^.\n]{0,80}?IELTS/gi;
  for (const m of text.matchAll(re)) {
    const score = Number(m[1] ?? m[2]);
    if (score < 4 || score > 9 || Math.round(score * 2) !== score * 2) continue;
    const context = excerptAround(text, m.index, m[0].length, 150);
    const isSection = /\b(no (band|sub-?score|component|section)|each (band|component|section|sub-?test)|any (band|component)|minimum of \d(?:\.\d)? in)\b/i.test(context);
    const isOverall = /\b(overall|composite|total|average)\b/i.test(context);
    results.push({ score, kind: isSection && !isOverall ? 'section' : isOverall ? 'overall' : 'unqualified', excerpt: context, index: m.index });
  }
  return results;
}

export function extractTOEFL(text) {
  const results = [];
  for (const m of text.matchAll(/TOEFL[^.\n]{0,120}?(\d{2,3})/gi)) {
    const score = Number(m[1]);
    if (score < 30 || score > 120) continue;
    results.push({ score, excerpt: excerptAround(text, m.index, m[0].length, 150), index: m.index });
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Testing policy                                                      */
/* ------------------------------------------------------------------ */

/**
 * Classifies SAT/ACT policy from explicit language only.
 *
 * Policies changed repeatedly between 2020 and 2026, so a page can contain both
 * a current statement and a historical one. When signals conflict the result is
 * `ambiguous` rather than a confident guess.
 */
export function extractTestingPolicy(text) {
  const signals = [];
  const add = (policy, re) => {
    const m = re.exec(text);
    if (m) signals.push({ policy, excerpt: excerptAround(text, m.index, m[0].length, 160), index: m.index });
  };
  add('optional', /\btest[- ]optional\b/i);
  add('optional', /\bdo(es)? not require (the )?(SAT|ACT|standardi[sz]ed test)/i);
  add('not-used', /\btest[- ]blind\b|\bwill not (be )?consider (SAT|ACT)/i);
  add('required', /\b(SAT|ACT)[^.\n]{0,60}\b(is|are) required\b/i);
  add('required', /\brequire[sd]?\b[^.\n]{0,40}\b(SAT|ACT)\b/i);
  add('recommended', /\b(SAT|ACT)[^.\n]{0,60}\b(recommended|strongly encouraged)\b/i);

  const kinds = new Set(signals.map((s) => s.policy));
  return {
    policy: kinds.size === 1 ? [...kinds][0] : null,
    ambiguous: kinds.size > 1,
    signals,
  };
}

/* ------------------------------------------------------------------ */
/* Financial aid policy                                                */
/* ------------------------------------------------------------------ */

/**
 * Reads aid policy, keeping the distinctions the financial matcher depends on.
 *
 * Three traps this guards against, all of which produce a confident wrong answer
 * if collapsed:
 *   - "scholarships are available" does not mean a full ride exists
 *   - "full tuition" does not cover living costs
 *   - aid offered to domestic students is routinely unavailable to internationals
 */
export function extractAidPolicy(text) {
  const near = (re) => {
    const m = re.exec(text);
    return m ? { found: true, excerpt: excerptAround(text, m.index, m[0].length, 200), index: m.index } : { found: false };
  };

  const meetsFullNeed = near(/\bmeets? (100%|the full|full) (of )?(the )?demonstrated (financial )?need\b/i);
  const needBlind = near(/\bneed[- ]blind\b/i);
  const needAware = near(/\bneed[- ]aware\b|\bneed[- ]sensitive\b/i);
  const fullRide = near(/\bfull[- ]ride\b|\b(covers?|covering) (full )?tuition[^.\n]{0,60}\b(living|housing|accommodation|room and board)\b/i);
  const fullTuition = near(/\bfull[- ]tuition\b|\bcovers? (the )?(full|entire) (cost of )?tuition\b/i);
  const meritExists = near(/\bmerit[- ](based )?(scholarship|award)\b/i);
  const anyScholarship = near(/\bscholarship(s)?\b/i);

  // International eligibility must be stated, never inferred from generic aid text.
  const intlEligible = near(/\b(international|non-?(US|U\.S\.|domestic|EU|EEA|local))\s+(students?|applicants?|citizens?)\b[^.\n]{0,120}\b(are )?(eligible|considered|may apply|can apply|qualify)\b/i);
  const intlExcluded = near(/\b(only|restricted to|limited to)\s+(domestic|home|US|U\.S\.|EU|EEA|local|citizens?|permanent residents?)\b|\bnot available to international\b|\binternational students are not eligible\b/i);

  return {
    meetsFullNeed,
    needBlind,
    needAware,
    fullRide,
    fullTuition,
    meritExists,
    anyScholarship,
    internationalEligible: intlEligible,
    internationalExcluded: intlExcluded,
  };
}

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Extracts dates alongside the deadline wording that gives them meaning. */
export function extractDeadlines(text) {
  const out = [];
  const re = /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/gi;

  for (const m of text.matchAll(re)) {
    let day, month, year;
    if (m[1]) {
      day = Number(m[1]); month = MONTHS[m[2].toLowerCase()]; year = Number(m[3]);
    } else {
      month = MONTHS[m[4].toLowerCase()]; day = Number(m[5]); year = Number(m[6]);
    }
    if (!month || !day || day > 31) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(iso))) continue;

    const context = excerptAround(text, m.index, m[0].length, 170);
    const kind =
      /\bscholarship|financial aid|bursary|funding\b/i.test(context) ? 'scholarship'
      : /\bearly (action|decision)\b/i.test(context) ? 'early'
      : /\b(regular|final|application) (decision|deadline|due)\b|\bdeadline\b|\bdue\b|\bcloses?\b/i.test(context) ? 'application'
      : 'unqualified';

    out.push({ date: iso, kind, excerpt: context, index: m.index });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Common Data Set                                                     */
/* ------------------------------------------------------------------ */

/**
 * Specialised Common Data Set extractor.
 *
 * The CDS is the highest-value source available for US institutions: it is
 * first-party, published to a fixed schema with stable section codes, and it
 * carries exactly the fields this engine scores on. Section codes make
 * extraction deterministic in a way that free-form web pages never are.
 */
export function extractCommonDataSet(text) {
  const out = { detected: false, academicYear: null, fields: {} };
  if (!/common data set/i.test(text)) return out;
  out.detected = true;
  out.academicYear = detectAcademicYear(text).year;

  const section = (code, window = 900) => {
    const m = new RegExp(`\\b${code}\\b`, 'i').exec(text);
    return m ? text.slice(m.index, m.index + window) : null;
  };

  // C9: SAT/ACT percentile distribution.
  const c9 = section('C9');
  if (c9) {
    const sat = /SAT (?:Evidence-Based Read|Composite|Total)[^\n]*?(\d{3,4})[^\n]*?(\d{3,4})/i.exec(c9);
    if (sat) {
      out.fields.sat25 = { value: Number(sat[1]), excerpt: sat[0].slice(0, 200) };
      out.fields.sat75 = { value: Number(sat[2]), excerpt: sat[0].slice(0, 200) };
    }
  }

  // C8: testing policy.
  const c8 = section('C8');
  if (c8) {
    const policy = extractTestingPolicy(c8);
    if (policy.policy) out.fields.satPolicy = { value: policy.policy, excerpt: policy.signals[0]?.excerpt };
  }

  // G0/G1: tuition and fees.
  const g = section('G0', 1600) ?? section('G1', 1600);
  if (g) {
    const money = moneyNear(g, ['tuition']);
    const annual = money.find((m) => m.unit !== 'per-credit' && m.unit !== 'per-month');
    if (annual) out.fields.tuition = { value: annual.value, currency: annual.currency, excerpt: annual.excerpt };
  }

  // C1/C2: applicants and admits, from which selectivity is derived.
  const c1 = section('C1', 600);
  if (c1) {
    const nums = [...c1.matchAll(/\b(\d{3,7})\b/g)].map((m) => Number(m[1]));
    if (nums.length >= 2 && nums[1] > 0 && nums[1] <= nums[0]) {
      out.fields.admitRate = {
        value: Math.round((nums[1] / nums[0]) * 1000) / 10,
        excerpt: c1.slice(0, 200),
        note: 'derived from applicants and admits in section C1',
      };
    }
  }

  return out;
}
