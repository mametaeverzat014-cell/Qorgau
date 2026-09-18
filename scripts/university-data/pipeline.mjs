/**
 * Pipeline stages: discover, fetch, extract, validate.
 *
 * Each stage writes to its own directory so raw, extracted and approved data are
 * never confused:
 *
 *   data/raw/<id>/        fetched documents exactly as received
 *   data/extracted/<id>/  candidate values with evidence
 *   data/approved/<id>/   values a human has approved
 *
 * Nothing here writes to data/approved. Only the approve command does that, and
 * only after a human has seen a diff.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_DIR, getEntry, PAGE_KINDS } from './registry.mjs';
import { safeFetch, looksLikeChallenge, assertSafeId } from './safety.mjs';
import { discoverPages, isNonContentUrl } from './discovery.mjs';
import {
  htmlToText, pageTitle, detectAcademicYear, extractMoneyScoped, extractIELTS, extractTOEFL,
  extractTestingPolicy, extractAidPolicy, extractDeadlines, extractCommonDataSet, mainContent,
  headings, detectApplicantScope,
} from './extract.mjs';
import {
  validateMoneyCandidate, validateIELTS, validateTOEFL, validateDeadline,
  deriveAidFlags, validateRecordConsistency, verdictFor, scopeMayServeField, EVIDENCE, VERDICT,
} from './validate.mjs';

const dirFor = (stage, id) => join(DATA_DIR, stage, assertSafeId(id));
const ensure = (d) => (mkdirSync(d, { recursive: true }), d);
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------------ */
/* Phase 5 — discovery                                                 */
/* ------------------------------------------------------------------ */

/**
 * Discovers official pages for one institution.
 *
 * The work lives in discovery.mjs; this wrapper only adapts the result to the
 * shape the registry stores. See that module for why a sitemap can never come
 * back from here as an admissions page.
 */
export async function discover(registry, id, { log = console.log, debug = false, fetchImpl } = {}) {
  const entry = getEntry(registry, id);
  const result = await discoverPages(entry, { log, debug, ...(fetchImpl ? { fetchImpl } : {}) });
  return { ...result, requests: result.diagnostics.requests };
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

export async function fetchPages(registry, id, { log = console.log } = {}) {
  const entry = getEntry(registry, id);
  const outDir = ensure(dirFor('raw', id));
  const manifest = { id, fetchedAt: new Date().toISOString(), documents: [], failures: [] };
  /** One page can legitimately serve several kinds; fetch it once, record it per kind. */
  const byUrl = new Map();

  for (const kind of PAGE_KINDS) {
    const url = entry.pages?.[kind];
    if (!url) continue;
    // Defence in depth. Discovery already refuses to classify a sitemap, but a
    // registry file is a text file a human can edit, and a sitemap recorded as
    // a tuition page would hash cleanly and look perfectly healthy forever.
    const nonContent = isNonContentUrl(url);
    if (nonContent.nonContent) {
      manifest.failures.push({ kind, url, reason: `not a page: ${nonContent.reason}`, status: 0 });
      log(`  ${kind}: REFUSED (${nonContent.reason})`);
      continue;
    }

    const cached = byUrl.get(url);
    if (cached) {
      // Same document, separate evidence entry — the extractor reads it once per
      // kind, so tuition and cost-of-attendance each get their own provenance.
      manifest.documents.push({ ...cached, kind });
      log(`  ${kind}: ${cached.bytes} bytes (same page as ${cached.kind})`);
      continue;
    }

    const res = await safeFetch(url, entry.allowedDomains);
    if (!res.ok) {
      manifest.failures.push({ kind, url, reason: res.reason, status: res.status });
      log(`  ${kind}: FAILED (${res.reason})`);
      continue;
    }
    if (res.text && looksLikeChallenge(res.text)) {
      // A bot wall is not a tuition page. Recording it as one would poison the
      // content hash and make a broken source look healthy.
      manifest.failures.push({ kind, url, reason: 'bot challenge page, not real content', status: res.status });
      log(`  ${kind}: BLOCKED (bot challenge)`);
      continue;
    }
    const isPdf = res.contentType === 'application/pdf';
    if (res.contentType === 'application/xml' || res.contentType === 'text/xml') {
      // XML is fetchable so sitemaps can be read during discovery. It is never
      // a source document.
      manifest.failures.push({ kind, url, reason: `${res.contentType} is a machine-readable index, not a page`, status: res.status });
      log(`  ${kind}: REFUSED (${res.contentType})`);
      continue;
    }
    const file = `${kind}.${isPdf ? 'pdf' : 'html'}`;
    writeFileSync(join(outDir, file), res.body);
    const doc = {
      kind, url: res.url, file, contentType: res.contentType,
      bytes: res.body.length, contentHash: sha256(res.body), retrievedAt: new Date().toISOString(),
    };
    manifest.documents.push(doc);
    byUrl.set(url, doc);
    log(`  ${kind}: ${res.body.length} bytes`);
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/* ------------------------------------------------------------------ */
/* Phase 7 — structured extraction                                     */
/* ------------------------------------------------------------------ */

const evidenceFrom = (doc, sourceType, extra = {}) => ({
  url: doc.url,
  title: doc.title ?? undefined,
  retrievedAt: doc.retrievedAt,
  sourceType,
  contentHash: doc.contentHash,
  ...extra,
});

const sourceTypeFor = (doc) =>
  doc.kind === 'common_data_set' ? 'common_data_set'
  : doc.contentType === 'application/pdf' ? 'official_pdf'
  : 'official_web';

/**
 * Extracts candidate values from fetched documents.
 *
 * PDFs are recorded but not parsed: this pipeline intentionally ships no PDF
 * text layer and no OCR, because a half-working PDF parser produces
 * confident-looking garbage. A PDF is flagged for manual reading instead.
 */
export function extractFrom(id, manifest, { log = console.log } = {}) {
  const outDir = ensure(dirFor('extracted', id));
  const candidates = {};
  const notes = [];
  /** Figures found and deliberately not used, so a reviewer can see them. */
  const excludedFigures = [];
  /** Fields the documents said nothing about. Not the same as "false". */
  const noEvidence = [];

  const docs = manifest.documents.map((d) => {
    const raw = readFileSync(join(dirFor('raw', id), d.file));
    const isPdf = d.contentType === 'application/pdf';
    return { ...d, isPdf, html: isPdf ? null : raw.toString('utf8'), title: null };
  });

  for (const doc of docs) {
    if (doc.isPdf) {
      notes.push(`${doc.kind}: PDF at ${doc.url} was fetched but not parsed; read it manually and record values with --evidence`);
      continue;
    }
    doc.title = pageTitle(doc.html);
    // Extraction reads the page, not the template. Discovery has stripped
    // chrome before classification since the template contamination was found;
    // reading whole-page text here left the same navigation and footer able to
    // supply a tuition figure, an IELTS band or a deadline. The raw HTML stays
    // on disk untouched for provenance.
    const main = mainContent(doc.html);
    const mainHtml = main.html;
    const text = htmlToText(mainHtml);
    doc.contentCleaned = main.stripped || main.usedMain;
    const year = detectAcademicYear(text);
    const st = sourceTypeFor(doc);

    // Defence in depth. Discovery ranks pages by applicant scope; this refuses
    // them. A live run put Harvard's visiting-undergraduate page through as the
    // admissions source, and every value it yielded — a per-class fee, a
    // visiting-student English requirement, a visiting-student testing policy —
    // was a true fact about the wrong population. The scope is re-derived from
    // the document itself rather than trusted from the registry.
    doc.applicantScope = detectApplicantScope({
      url: doc.url, title: doc.title ?? '', headingList: headings(mainHtml), text,
    });
    const mayServe = (field) => {
      const verdict = scopeMayServeField(field, doc.applicantScope.scope);
      if (!verdict.ok) {
        noEvidence.push({ field, reason: verdict.reason, url: doc.url, kind: doc.kind, scope: doc.applicantScope.scope });
      }
      return verdict.ok;
    };

    // Common Data Set first — the strongest source when present.
    if (doc.kind === 'common_data_set') {
      const cds = extractCommonDataSet(text);
      if (cds.detected) {
        for (const [field, v] of Object.entries(cds.fields)) {
          candidates[field] ??= [];
          candidates[field].push({
            value: v.value, currency: v.currency ?? null, unit: 'per-year',
            academicYear: cds.academicYear, academicYearSource: 'common-data-set', excerpt: v.excerpt,
            evidence: evidenceFrom(doc, 'common_data_set', { academicYear: cds.academicYear, excerpt: v.excerpt }),
            confidence: 0.95,
          });
        }
      }
    }

    const pushMoney = (field, keywords) => {
      if (!mayServe(field)) return;
      // Scoped: each figure carries the academic year its own table column, row
      // or section states, rather than the whole page's year or nothing.
      const { kept, excluded } = extractMoneyScoped(mainHtml, keywords, { withExcluded: true });
      for (const m of kept) {
        candidates[field] ??= [];
        candidates[field].push({
          ...m,
          academicYear: m.academicYear ?? null,
          evidence: evidenceFrom(doc, st, { academicYear: m.academicYear ?? null, excerpt: m.excerpt }),
          confidence: m.isAnnual ? 0.85 : 0.5,
        });
      }
      for (const x of excluded) {
        excludedFigures.push({ field, value: x.value, currency: x.currency, reason: x.excludedBecause, excerpt: x.excerpt, url: doc.url });
      }
    };

    if (doc.kind === 'tuition' || doc.kind === 'cost_of_attendance') {
      pushMoney('tuition', ['tuition']);
      pushMoney('livingCost', ['housing', 'room and board', 'living', 'accommodation', 'residence']);
      pushMoney('totalCostOfAttendance', ['total', 'cost of attendance', 'estimated cost']);
    }
    if ((doc.kind === 'english_requirements' || doc.kind === 'international_admissions' || doc.kind === 'admissions')
        && mayServe('minimumIELTS') && mayServe('minimumTOEFL')) {
      for (const c of extractIELTS(text)) {
        candidates.minimumIELTS ??= [];
        candidates.minimumIELTS.push({ ...c, evidence: evidenceFrom(doc, st, { excerpt: c.excerpt }), confidence: c.kind === 'overall' ? 0.9 : 0.4 });
      }
      for (const c of extractTOEFL(text)) {
        candidates.minimumTOEFL ??= [];
        candidates.minimumTOEFL.push({ ...c, evidence: evidenceFrom(doc, st, { excerpt: c.excerpt }), confidence: 0.85 });
      }
    }
    if ((doc.kind === 'testing_policy' || doc.kind === 'admissions') && mayServe('satPolicy')) {
      const p = extractTestingPolicy(text);
      if (p.policy) {
        candidates.satPolicy ??= [];
        candidates.satPolicy.push({
          value: p.policy, ambiguous: p.ambiguous,
          evidence: evidenceFrom(doc, st, { excerpt: p.signals[0]?.excerpt }),
          confidence: p.ambiguous ? 0.4 : 0.9,
        });
      } else if (p.ambiguous) {
        notes.push(`${doc.kind}: conflicting testing-policy statements on one page; left unresolved`);
      }
    }
    if ((doc.kind === 'deadlines' || doc.kind === 'admissions' || doc.kind === 'scholarships')
        && mayServe('applicationDeadline') && mayServe('scholarshipDeadline')) {
      const ds = extractDeadlines(text);
      // Only create a field group when there is something in it. An empty group
      // is worse than no group: it reports "2 field groups extracted" while
      // validation silently skips both, which is exactly how a run can look
      // productive and produce nothing.
      for (const field of ['applicationDeadline', 'scholarshipDeadline']) {
        const rows = ds.map((d) => ({ ...d, evidence: evidenceFrom(doc, st, { excerpt: d.excerpt }), confidence: 0.75 }));
        if (rows.length === 0) continue;
        candidates[field] ??= [];
        candidates[field].push(...rows);
      }
    }
    if ((doc.kind === 'financial_aid' || doc.kind === 'international_financial_aid' || doc.kind === 'scholarships')
        && mayServe('aidCertainty')) {
      const signals = extractAidPolicy(text);
      const { flags, evidence, issues } = deriveAidFlags(signals);
      // Only fields the page actually speaks to become candidates. A field the
      // page is silent on is recorded as having no evidence, not as false.
      const spoken = Object.entries(evidence).filter(([, e]) => e.state !== EVIDENCE.UNKNOWN);
      for (const [field, e] of Object.entries(evidence)) {
        if (e.state === EVIDENCE.UNKNOWN) {
          noEvidence.push({ field, reason: e.reason, url: doc.url, kind: doc.kind });
        }
      }
      if (spoken.length > 0) {
        candidates.aidFlags ??= [];
        candidates.aidFlags.push({
          flags, evidence, issues,
          supportedFields: spoken.map(([f]) => f),
          evidenceExcerpt: signals.meetsFullNeed.excerpt ?? signals.competitiveAward.excerpt ?? signals.anyScholarship.excerpt,
          evidenceRef: evidenceFrom(doc, st, { excerpt: signals.meetsFullNeed.excerpt ?? signals.competitiveAward.excerpt ?? signals.anyScholarship.excerpt }),
          confidence: signals.internationalEligible.found ? 0.8 : 0.3,
        });
      }
    }
  }

  const out = {
    id, extractedAt: new Date().toISOString(), candidates, notes,
    excludedFigures, noEvidence,
    contentCleaned: docs.filter((d) => d.contentCleaned).length,
    sourceScopes: docs.filter((d) => !d.isPdf).map((d) => ({
      kind: d.kind, url: d.url, scope: d.applicantScope?.scope ?? 'unknown',
      markers: d.applicantScope?.markers ?? [],
    })),
  };
  writeFileSync(join(outDir, 'candidates.json'), JSON.stringify(out, null, 2) + '\n');
  const wrongScope = out.sourceScopes.filter((x) => !['first_year', 'international_first_year', 'general_undergraduate', 'unknown'].includes(x.scope));
  if (wrongScope.length) {
    for (const x of wrongScope) log(`  ${x.kind}: source is written for ${x.scope.replace(/_/g, ' ')} applicants; first-year fields refused`);
  }
  log(`  extracted ${Object.keys(candidates).length} field groups, ${excludedFigures.length} figures excluded by context, ${noEvidence.length} fields with no evidence, ${notes.length} notes`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Phase 9 — validate candidates into proposals                        */
/* ------------------------------------------------------------------ */

/** Turns raw candidates into at most one validated proposal per field. */
export function validateCandidates(id, extracted, { log = console.log } = {}) {
  const outDir = ensure(dirFor('extracted', id));
  const proposals = {};
  const rejected = [];
  /**
   * Fields the sources said nothing about.
   *
   * Kept separate from REJECT on purpose. "We read the page and it does not
   * state this" and "we read a value and it failed validation" are different
   * answers, and collapsing them into one forces a reviewer into a binary
   * choice about a field nobody has evidence for.
   */
  const noEvidence = [...(extracted.noEvidence ?? [])];

  const record = (field, value, evidence, issues, confidence) => {
    const v = verdictFor({ issues, hasEvidence: Boolean(evidence), confidence });
    if (v.verdict === VERDICT.REJECT) {
      rejected.push({ field, reason: v.reason, issues });
      return;
    }
    proposals[field] = {
      field, value, verdict: v.verdict, confidence,
      evidence: evidence ? [evidence] : [],
      issues, status: v.verdict === VERDICT.ACCEPT ? 'verified' : 'candidate',
    };
  };

  const c = extracted.candidates;

  for (const [field] of [['tuition'], ['livingCost'], ['totalCostOfAttendance']]) {
    const list = c[field];
    if (!list?.length) continue;
    // Strongest source, then the most recent cycle the page attributes, then an
    // explicitly annual figure.
    const best = [...list].sort(
      (a, b) => (b.evidence.sourceType === 'common_data_set' ? 1 : 0) - (a.evidence.sourceType === 'common_data_set' ? 1 : 0)
        || String(b.academicYear ?? '').localeCompare(String(a.academicYear ?? ''))
        || (b.isAnnual ? 1 : 0) - (a.isAnnual ? 1 : 0) || (b.confidence ?? 0) - (a.confidence ?? 0),
    )[0];
    const issues = validateMoneyCandidate(field, best);
    if (best.academicYearSource) {
      issues.push({
        field, severity: 'info',
        message: `academic year ${best.academicYear} taken from the ${best.academicYearSource.replace('-', ' ')}`,
      });
    }
    record(field, best.value, best.evidence, issues, best.confidence);
  }

  if (c.minimumIELTS?.length) {
    const r = validateIELTS(c.minimumIELTS);
    const ev = c.minimumIELTS.find((x) => x.kind === 'overall')?.evidence ?? c.minimumIELTS[0].evidence;
    record('minimumIELTS', r.value, ev, r.issues, 0.9);
  }
  if (c.minimumTOEFL?.length) {
    const r = validateTOEFL(c.minimumTOEFL);
    record('minimumTOEFL', r.value, c.minimumTOEFL[0].evidence, r.issues, 0.85);
  }
  if (c.satPolicy?.length) {
    const best = c.satPolicy[0];
    const issues = best.ambiguous
      ? [{ field: 'satPolicy', severity: 'error', message: 'the page states more than one testing policy; likely a stale statement alongside a current one' }]
      : [];
    record('satPolicy', best.value, best.evidence, issues, best.confidence);
  }
  for (const field of ['applicationDeadline', 'scholarshipDeadline']) {
    if (!c[field]?.length) continue;
    const r = validateDeadline(field, c[field]);
    record(field, r.value, c[field][0].evidence, r.issues, 0.75);
  }

  if (c.aidFlags?.length) {
    const best = [...c.aidFlags].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    for (const [field, e] of Object.entries(best.evidence)) {
      if (e.state === EVIDENCE.UNKNOWN) continue;   // already in noEvidence
      // aidCertainty goes through the same gate as everything else. It used to
      // be written straight into the proposals map, which is how an unsupported
      // "competitive" reached review alongside a validator note saying the page
      // established nothing.
      record(field, e.value, best.evidenceRef, [...best.issues], best.confidence);
    }
  }

  const flat = Object.fromEntries(Object.entries(proposals).map(([k, p]) => [k, p.value]));
  const consistency = validateRecordConsistency(flat);
  for (const issue of consistency) {
    if (proposals[issue.field]) {
      proposals[issue.field].issues.push(issue);
      if (issue.severity === 'error') {
        proposals[issue.field].verdict = VERDICT.REVIEW_REQUIRED;
        proposals[issue.field].status = 'candidate';
      }
    }
  }

  // A field that is neither proposed nor rejected, and that a document was
  // silent on, belongs in the no-evidence list rather than nowhere.
  const accounted = new Set([...Object.keys(proposals), ...rejected.map((r) => r.field)]);
  const unexplained = noEvidence.filter((n) => !accounted.has(n.field));

  const out = {
    id, validatedAt: new Date().toISOString(), proposals, rejected,
    noEvidence: unexplained, excludedFigures: extracted.excludedFigures ?? [], consistency,
  };
  writeFileSync(join(outDir, 'proposals.json'), JSON.stringify(out, null, 2) + '\n');
  const accepted = Object.values(proposals).filter((p) => p.verdict === VERDICT.ACCEPT).length;
  const review = Object.values(proposals).filter((p) => p.verdict === VERDICT.REVIEW_REQUIRED).length;
  log(`  ${accepted} accepted, ${review} need review, ${rejected.length} rejected, ${unexplained.length} with no evidence`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Approved-data access                                                */
/* ------------------------------------------------------------------ */

export function loadApproved(id) {
  const p = join(dirFor('approved', id), 'approved.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function saveApproved(id, data) {
  const dir = ensure(dirFor('approved', id));
  const p = join(dir, 'approved.json');
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

export function loadProposals(id) {
  const p = join(dirFor('extracted', id), 'proposals.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function listApprovedIds() {
  const dir = join(DATA_DIR, 'approved');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
