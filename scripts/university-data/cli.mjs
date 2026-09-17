#!/usr/bin/env node
/**
 * AdmitPath university data pipeline CLI.
 *
 * The important property of this tool is what it cannot do: no command except
 * `approve` writes to data/approved, and `approve` refuses to run without an
 * explicit --yes from a human who has seen the diff. Ingestion proposes;
 * people decide.
 *
 *   node scripts/university-data/cli.mjs <command> [--flags]
 *
 * Commands: init-registry, discover, ingest, review, approve, diff,
 *           check-freshness, coverage, status
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRegistry, loadRegistry, saveRegistry, getEntry, readCuratedUniversities,
  REGISTRY_PATH, DATA_DIR, PAGE_KINDS,
} from './registry.mjs';
import { safeFetch, looksLikeChallenge, assertSafeId } from './safety.mjs';
import {
  discover, fetchPages, extractFrom, validateCandidates,
  loadApproved, saveApproved, loadProposals, listApprovedIds, sha256,
} from './pipeline.mjs';
import { VERDICT } from './validate.mjs';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback = null) => {
  const withEq = args.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  if (i !== -1) return args[i + 1]?.startsWith('--') ? true : (args[i + 1] ?? true);
  return fallback;
};
const has = (name) => args.includes(`--${name}`);

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
};

function requireRegistry() {
  const r = loadRegistry();
  if (!r) {
    console.error(c.r('No registry found. Run: npm run data:init'));
    process.exit(1);
  }
  return r;
}

/* ------------------------------------------------------------------ */

async function cmdInitRegistry() {
  const existing = loadRegistry();
  const built = buildRegistry();
  if (existing) {
    // Preserve discovered URLs; never clobber human-curated registry work.
    for (const e of built.universities) {
      const prev = existing.universities.find((u) => u.id === e.id);
      if (prev) {
        e.pages = { ...e.pages, ...prev.pages };
        e.allowedDomains = [...new Set([...e.allowedDomains, ...(prev.allowedDomains ?? [])])];
        e.discovery = prev.discovery ?? e.discovery;
      }
    }
  }
  const p = saveRegistry(built);
  console.log(`${c.g('✓')} registry written: ${p}`);
  console.log(`  ${built.universities.length} institutions, ${PAGE_KINDS.length} page kinds each`);
  console.log(c.dim('  Page URLs start null on purpose. Run `discover` with network access to fill them.'));
}

async function cmdDiscover() {
  const registry = requireRegistry();
  const id = flag('university');
  if (!id) { console.error(c.r('--university=<id> is required')); process.exit(1); }
  const entry = getEntry(registry, assertSafeId(id));
  console.log(c.b(`Discovering official pages for ${entry.officialName}`));
  console.log(c.dim(`  allowed domains: ${entry.allowedDomains.join(', ')}`));

  const result = await discover(registry, id);
  if (result.status === 'failed') {
    console.log(c.y('  No pages reachable. If this environment has no network access, that is expected.'));
  }
  for (const [kind, page] of Object.entries(result.found)) {
    entry.pages[kind] = page.url;
    console.log(`  ${c.g('found')} ${kind}: ${page.url}`);
  }
  entry.discovery = { status: result.status, lastAttemptedAt: new Date().toISOString(), notes: `${result.requests} requests` };
  saveRegistry(registry);
}

async function cmdIngest() {
  const registry = requireRegistry();
  const id = flag('university');
  if (!id) { console.error(c.r('--university=<id> is required')); process.exit(1); }
  const entry = getEntry(registry, assertSafeId(id));
  const configured = Object.values(entry.pages).filter(Boolean).length;

  console.log(c.b(`Ingesting ${entry.officialName}`));
  if (configured === 0) {
    console.log(c.y('  No page URLs in the registry for this institution.'));
    console.log(c.dim('  Run `discover` first (needs network), or add URLs to data/registry/universities.registry.json by hand.'));
    return;
  }

  console.log(c.dim('  fetching...'));
  const manifest = await fetchPages(registry, id);
  console.log(c.dim('  extracting...'));
  const extracted = extractFrom(id, manifest);
  console.log(c.dim('  validating...'));
  validateCandidates(id, extracted);

  console.log(`\n${c.g('✓')} candidates written to data/extracted/${id}/`);
  console.log(c.b('  Nothing has reached production data. Next: ') + `npm run data:review -- --university=${id}`);
}

/* ------------------------------------------------------------------ */
/* Phase 11 — human review gate                                        */
/* ------------------------------------------------------------------ */

function currentValueFor(id, field) {
  const curated = readCuratedUniversities().find((u) => u.id === id);
  if (!curated) return undefined;
  const map = {
    tuition: curated.tuition, livingCost: curated.livingCost,
    minimumIELTS: curated.minimumIELTS, minimumTOEFL: curated.minimumTOEFL,
    satPolicy: curated.satPolicy, applicationDeadline: curated.applicationDeadline,
    scholarshipDeadline: curated.scholarshipDeadline, applicationPlatform: curated.applicationPlatform,
    fullRidePossible: curated.fullRidePossible, fullTuitionPossible: curated.fullTuitionPossible,
    needBasedAidForInternationals: curated.needBasedAidForInternationals,
    aidCertainty: curated.aidCertainty,
  };
  return map[field];
}

function cmdReview() {
  const id = flag('university');
  if (!id) { console.error(c.r('--university=<id> is required')); process.exit(1); }
  assertSafeId(id);
  const proposals = loadProposals(id);
  if (!proposals) {
    console.error(c.r(`No proposals for "${id}". Run: npm run data:ingest -- --university=${id}`));
    process.exit(1);
  }

  console.log(c.b(`\nReview: ${id}`));
  console.log(c.dim(`validated ${proposals.validatedAt}\n`));

  const entries = Object.values(proposals.proposals);
  if (entries.length === 0) console.log(c.dim('  no proposals'));

  for (const p of entries) {
    const current = currentValueFor(id, p.field);
    const changed = current !== undefined && String(current) !== String(p.value);
    const tag =
      p.verdict === VERDICT.ACCEPT ? c.g('ACCEPT')
      : p.verdict === VERDICT.REVIEW_REQUIRED ? c.y('REVIEW REQUIRED') : c.r('REJECT');

    console.log(c.b(p.field.toUpperCase()));
    if (current !== undefined) console.log(`  current:   ${current ?? '—'}`);
    console.log(`  candidate: ${p.value ?? '—'}   ${changed ? c.y('CHANGED') : c.dim('unchanged')}`);
    const ev = p.evidence?.[0];
    if (ev) {
      console.log(`  source:    ${ev.url}`);
      console.log(`  type:      ${ev.sourceType}${ev.academicYear ? `   academic year: ${ev.academicYear}` : ''}`);
      console.log(`  retrieved: ${ev.retrievedAt}`);
      if (ev.excerpt) console.log(c.dim(`  excerpt:   "${ev.excerpt.slice(0, 160)}"`));
    } else {
      console.log(c.r('  source:    none — this cannot be approved'));
    }
    console.log(`  confidence: ${p.confidence ?? '—'}`);
    console.log(`  status:    ${tag}`);
    for (const i of p.issues ?? []) {
      console.log(`  ${i.severity === 'error' ? c.r('!') : c.y('·')} ${i.message}`);
    }
    console.log('');
  }

  if (proposals.rejected?.length) {
    console.log(c.b('REJECTED CANDIDATES'));
    for (const r of proposals.rejected) console.log(`  ${c.r('✗')} ${r.field}: ${r.reason}`);
    console.log('');
  }

  const approvable = entries.filter((p) => p.evidence?.length > 0);
  console.log(c.b('To approve the fields above, with evidence:'));
  console.log(`  npm run data:approve -- --university=${id} --fields=${approvable.map((p) => p.field).join(',') || '<none>'} --yes`);
  console.log(c.dim('  Approval is explicit and per field. Nothing is approved automatically.'));
}

function cmdApprove() {
  const id = flag('university');
  const fieldsArg = flag('fields');
  if (!id || !fieldsArg || fieldsArg === true) {
    console.error(c.r('--university=<id> and --fields=a,b,c are required'));
    process.exit(1);
  }
  assertSafeId(id);
  if (!has('yes')) {
    console.error(c.r('Refusing to approve without --yes.'));
    console.error(c.dim('  Approval writes to production data. Run `data:review` first and pass --yes deliberately.'));
    process.exit(1);
  }

  const proposals = loadProposals(id);
  if (!proposals) { console.error(c.r(`No proposals for "${id}"`)); process.exit(1); }

  const wanted = String(fieldsArg).split(',').map((s) => s.trim()).filter(Boolean);
  const approved = loadApproved(id) ?? { id, fields: {}, history: [] };
  const accepted = [];
  const refused = [];

  for (const field of wanted) {
    const p = proposals.proposals[field];
    if (!p) { refused.push([field, 'no such proposal']); continue; }
    if (!p.evidence?.length) { refused.push([field, 'no evidence attached']); continue; }
    if (p.value === null || p.value === undefined) { refused.push([field, 'value is null']); continue; }

    approved.fields[field] = {
      value: p.value,
      // Human approval is what promotes a candidate; extraction never can.
      status: 'verified',
      evidence: p.evidence,
      confidence: p.confidence,
      approvedAt: new Date().toISOString(),
      approvedBy: process.env.USER || process.env.USERNAME || 'unknown',
    };
    accepted.push(field);
  }

  approved.history.push({ at: new Date().toISOString(), approved: accepted, refused: refused.map(([f, r]) => `${f}: ${r}`) });
  const path = saveApproved(id, approved);

  for (const f of accepted) console.log(`${c.g('✓')} approved ${f}`);
  for (const [f, r] of refused) console.log(`${c.r('✗')} refused ${f}: ${r}`);
  console.log(`\nwritten: ${path}`);
  console.log(c.dim('  Approved values are picked up by the app via the evidence overlay.'));
}

function cmdDiff() {
  const ids = flag('university') ? [assertSafeId(flag('university'))] : listApprovedIds();
  if (ids.length === 0) { console.log(c.dim('No approved data yet.')); return; }
  let changes = 0;
  for (const id of ids) {
    const approved = loadApproved(id);
    if (!approved) continue;
    for (const [field, a] of Object.entries(approved.fields)) {
      const current = currentValueFor(id, field);
      if (current !== undefined && String(current) !== String(a.value)) {
        changes++;
        console.log(`${c.y('CHANGED')} ${id}.${field}: dataset ${current} vs approved ${a.value}`);
        console.log(c.dim(`  ${a.evidence[0]?.url}`));
      }
    }
  }
  console.log(changes === 0 ? c.g('\nNo differences between approved data and the shipped dataset.') : `\n${changes} difference(s).`);
}

/* ------------------------------------------------------------------ */
/* Phase 12 — freshness                                                */
/* ------------------------------------------------------------------ */

async function cmdCheckFreshness() {
  const registry = requireRegistry();
  const onlyId = flag('university');
  const targets = onlyId ? [getEntry(registry, assertSafeId(onlyId))] : registry.universities;

  const report = { checkedAt: new Date().toISOString(), current: [], review: [], broken: [], unconfigured: [] };

  for (const entry of targets) {
    const urls = Object.entries(entry.pages ?? {}).filter(([, u]) => u);
    if (urls.length === 0) { report.unconfigured.push({ id: entry.id, reason: 'no page URLs in registry' }); continue; }

    const approved = loadApproved(entry.id);
    for (const [kind, url] of urls) {
      const res = await safeFetch(url, entry.allowedDomains);
      if (!res.ok) {
        report.broken.push({ id: entry.id, kind, url, reason: res.reason, status: res.status });
        continue;
      }
      if (res.text && looksLikeChallenge(res.text)) {
        report.broken.push({ id: entry.id, kind, url, reason: 'bot challenge page', status: res.status });
        continue;
      }
      const hash = sha256(res.body);
      const known = Object.values(approved?.fields ?? {}).flatMap((f) => f.evidence ?? []).find((e) => e.url === url);
      if (known?.contentHash && known.contentHash !== hash) {
        report.review.push({ id: entry.id, kind, url, reason: 'source content changed since approval' });
      } else {
        report.current.push({ id: entry.id, kind, url });
      }
    }
  }

  const out = join(DATA_DIR, 'freshness-report.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');

  console.log(c.b('\nFreshness report'));
  for (const r of report.review) console.log(`${c.y('REVIEW REQUIRED')} ${r.id} ${r.kind}: ${r.reason}`);
  for (const b of report.broken) console.log(`${c.r('SOURCE BROKEN')}  ${b.id} ${b.kind}: ${b.reason}`);
  if (report.unconfigured.length) console.log(c.dim(`\n${report.unconfigured.length} institution(s) have no configured source URLs yet.`));
  console.log(`\n${c.g(String(report.current.length))} current · ${c.y(String(report.review.length))} need review · ${c.r(String(report.broken.length))} broken`);
  console.log(c.dim(`report: ${out}`));
  console.log(c.dim('Production data is never updated by this command.'));

  if (report.broken.length > 0 && has('strict')) process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Phase 15 — coverage                                                 */
/* ------------------------------------------------------------------ */

function cmdCoverage() {
  const us = readCuratedUniversities();
  const approvedIds = listApprovedIds();
  const group = (fn) => {
    const m = {};
    for (const u of us) { const k = fn(u) ?? 'unknown'; m[k] = (m[k] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const section = (title, rows) => {
    console.log(c.b(`\n${title}`));
    for (const [k, v] of rows) console.log(`  ${String(v).padStart(3)}  ${k}${v === 1 ? c.dim('   <- single-university') : ''}`);
  };

  console.log(c.b(`\nDataset coverage — ${us.length} universities`));
  section('By country', group((u) => u.country));
  section('By region', group((u) => u.region));
  section('By aid certainty', group((u) => u.aidCertainty));

  const bands = { '<5k': 0, '5-15k': 0, '15-30k': 0, '30-50k': 0, '50k+': 0 };
  for (const u of us) {
    const t = (u.tuition ?? 0) + (u.livingCost ?? 0);
    if (t < 5000) bands['<5k']++; else if (t < 15000) bands['5-15k']++;
    else if (t < 30000) bands['15-30k']++; else if (t < 50000) bands['30-50k']++; else bands['50k+']++;
  }
  section('By total annual cost', Object.entries(bands));

  console.log(c.b('\nEvidence coverage'));
  console.log(`  ${approvedIds.length}/${us.length} institutions have any source-backed approved field`);
  if (approvedIds.length === 0) {
    console.log(c.dim('  No ingestion has been run yet. Every field is curated, and the UI says so.'));
  }
  const single = group((u) => u.country).filter(([, n]) => n === 1);
  console.log(c.b(`\nBiggest gap: ${single.length} countries hold exactly one university`));
  console.log(c.dim(`  ${single.map(([k]) => k).join(', ')}`));
}

function cmdStatus() {
  const registry = loadRegistry();
  const us = readCuratedUniversities();
  console.log(c.b('\nPipeline status'));
  console.log(`  registry:        ${registry ? c.g('present') : c.r('missing — run npm run data:init')}`);
  if (registry) {
    const withPages = registry.universities.filter((u) => Object.values(u.pages ?? {}).some(Boolean)).length;
    console.log(`  institutions:    ${registry.universities.length}`);
    console.log(`  with source URLs:${String(withPages).padStart(3)}  ${withPages === 0 ? c.dim('(run discover with network access)') : ''}`);
  }
  console.log(`  curated dataset: ${us.length} universities`);
  console.log(`  approved data:   ${listApprovedIds().length} institutions`);
  console.log(c.dim('\n  The app reads the curated dataset. Approved evidence overlays it; it never silently replaces it.'));
}

/* ------------------------------------------------------------------ */

const COMMANDS = {
  'init-registry': cmdInitRegistry,
  discover: cmdDiscover,
  ingest: cmdIngest,
  review: cmdReview,
  approve: cmdApprove,
  diff: cmdDiff,
  'check-freshness': cmdCheckFreshness,
  coverage: cmdCoverage,
  status: cmdStatus,
};

const fn = COMMANDS[command];
if (!fn) {
  console.log(c.b('AdmitPath university data pipeline\n'));
  console.log('Commands:');
  console.log('  init-registry                        build/refresh the registry from the curated dataset');
  console.log('  discover        --university=<id>    find official pages (needs network)');
  console.log('  ingest          --university=<id>    fetch, extract, validate -> candidates');
  console.log('  review          --university=<id>    show candidates with evidence and diffs');
  console.log('  approve         --university=<id> --fields=a,b --yes');
  console.log('  diff            [--university=<id>]  approved vs shipped dataset');
  console.log('  check-freshness [--university=<id>] [--strict]');
  console.log('  coverage                             dataset coverage report');
  console.log('  status                               pipeline state');
  process.exit(command ? 1 : 0);
}

try {
  await fn();
} catch (e) {
  console.error(c.r(`\n${e.message}`));
  process.exit(1);
}
