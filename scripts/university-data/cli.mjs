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
 * Commands: init-registry, discover, add-domain, probe-urls, ingest, review,
 *           approve, diff, check-freshness, coverage, status
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRegistry, loadRegistry, saveRegistry, getEntry, readCuratedUniversities,
  addDomain, rootDomainOf, REGISTRY_PATH, DATA_DIR, PAGE_KINDS,
} from './registry.mjs';
import { isNonContentUrl } from './discovery.mjs';
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
        // Carry over discovered URLs, minus anything that is not a page. A
        // sitemap recorded by an earlier build must not be preserved as
        // "human-curated registry work".
        const kept = Object.fromEntries(
          Object.entries(prev.pages ?? {}).map(([k, u]) => [k, u && isNonContentUrl(u).nonContent ? null : u]),
        );
        e.pages = { ...e.pages, ...kept };
        // Domains a human approved are kept; rebuilding the registry must never
        // quietly narrow or widen an allow-list someone signed off on.
        e.officialDomains = [...new Set([...e.officialDomains, ...(prev.officialDomains ?? prev.allowedDomains ?? [])])];
        e.trustedSubdomains = [...new Set([...(prev.trustedSubdomains ?? [])])];
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
  const debug = has('debug');

  console.log(c.b(`Discovering official pages for ${entry.officialName}`));
  console.log(c.dim(`  root:            ${entry.officialRootUrl}`));
  console.log(c.dim(`  official domains: ${entry.officialDomains.join(', ') || '—'}`));
  console.log(c.dim(`  trusted subdomains: ${entry.trustedSubdomains.join(', ') || '—'}`));

  // Self-healing: an earlier build could record a sitemap as a source page.
  // Purge anything the current rules would never accept before writing new
  // results, so a bad URL cannot survive in a registry indefinitely.
  const purged = [];
  for (const [kind, url] of Object.entries(entry.pages ?? {})) {
    if (url && isNonContentUrl(url).nonContent) { entry.pages[kind] = null; purged.push(`${kind}: ${url}`); }
  }
  if (purged.length) {
    console.log(c.y(`\n  Removed ${purged.length} stored URL(s) that are not pages:`));
    for (const line of purged) console.log(c.dim(`    ${line}`));
  }

  const result = await discover(registry, id, { debug });
  const d = result.diagnostics;

  console.log(c.b('\nWhat was inspected'));
  console.log(`  sitemaps named in robots.txt: ${d.robotsSitemaps.length}`);
  for (const sm of d.robotsSitemaps.slice(0, 10)) console.log(c.dim(`    ${sm}`));
  console.log(`  sitemap documents fetched:    ${d.sitemapsFetched}`);
  console.log(`  URLs discovered in sitemaps:  ${d.sitemapUrlsDiscovered}`);
  console.log(`  non-content URLs skipped:     ${d.nonContentUrlsSkipped} ${c.dim('(sitemaps, feeds, assets — never evidence)')}`);
  console.log(`  candidate URLs considered:    ${d.candidatesConsidered}`);
  console.log(`  pages fetched:                ${d.pagesFetched}`);
  console.log(`  pages classified by content:  ${d.pagesClassified}`);
  console.log(`  HTTP requests total:          ${d.requests}${d.budgetExhausted ? c.y('  (budget exhausted)') : ''}`);

  console.log(`  pages whose chrome was stripped: ${d.chromeStrippedPages}`);
  console.log(`  duplicate pages skipped:      ${d.duplicatePagesSkipped}`);
  console.log(`  candidates left unfetched:     ${d.candidatesSkippedForBudget}`);

  console.log(c.b('\nFOUND'));
  const foundEntries = Object.entries(result.found);
  if (foundEntries.length === 0) console.log(c.dim('  nothing'));
  for (const [kind, page] of foundEntries) {
    entry.pages[kind] = page.url;
    const role = page.sourceRole === 'canonical' ? c.g(page.sourceRole)
      : page.sourceRole === 'supporting' ? page.sourceRole : c.y(page.sourceRole);
    console.log(`  ${c.g(kind)}`);
    console.log(`    ${page.url}`);
    if (page.title) console.log(c.dim(`    title:      ${page.title}`));
    console.log(`    relevance ${page.relevanceScore}  ·  authority ${page.authorityScore}  ·  final ${page.score}`);
    console.log(`    scope ${c.b(page.applicantScope?.scope ?? 'unknown')}  ·  role ${role}  ·  ${page.temporalStatus}`
      + (page.publishedDate ? c.dim(`  (published ${page.publishedDate})`) : '')
      + (page.updatedDate ? c.dim(`  (updated ${page.updatedDate})`) : ''));
    console.log(c.dim(`    why:        ${page.whySelected}`));
    console.log(c.dim(`    via:        ${page.discoveredVia}  ·  signal: ${page.contentSignal}`));
    if (page.runnerUp) {
      console.log(c.dim(`    runner-up:  ${page.runnerUp.url}`));
      console.log(c.dim(`                lost because: ${page.runnerUp.whyItLost} (${page.runnerUp.score}, ${page.runnerUp.role})`));
    } else {
      console.log(c.dim('    runner-up:  none — nothing else qualified'));
    }
    if (page.requiresManualReading) console.log(c.y('    PDF — values must be read by a human, nothing here parses PDF text'));
  }

  console.log(c.b('\nNOT FOUND'));
  if (result.notFound.length === 0) console.log(c.dim('  —'));
  for (const kind of result.notFound) {
    const rejected = result.rejectedForQuality.find((x) => x.kind === kind);
    if (rejected) {
      console.log(`  ${c.y(kind)} ${c.dim('— a candidate was found and refused')}`);
      console.log(c.dim(`      ${rejected.url}`));
      console.log(c.dim(`      ${rejected.reason}`));
    } else {
      console.log(`  ${c.y(kind)} ${c.dim('— no page on an approved domain both matched and said so in its own content')}`);
    }
  }

  if (result.manualReview.length) {
    console.log(c.b('\nFOR MANUAL READING'));
    for (const m of result.manualReview) console.log(`  ${m.url}\n    ${c.dim(m.reason)}`);
  }

  if (result.domainCandidates.length) {
    console.log(c.b('\nDOMAIN CANDIDATES — not trusted, not fetched'));
    console.log(c.dim('  Hosts an already-trusted page linked to that share a name with this institution.'));
    console.log(c.dim('  A link is not proof of ownership. Check each one yourself before approving it.'));
    for (const dc of result.domainCandidates) {
      console.log(`  ${dc.host}  ${c.dim(`(${dc.occurrences} link${dc.occurrences === 1 ? '' : 's'}, e.g. "${dc.anchors[0] ?? dc.examples[0]}")`)}`);
      console.log(c.dim(`      why:     ${dc.reason}`));
      console.log(c.dim(`      seen on  ${dc.linkedFrom}`));
      console.log(c.dim(`      approve: npm run data:add-domain -- --university=${entry.id} --domain=${dc.host} --yes`));
    }
  }

  if (debug && result.externalLinks.length) {
    console.log(c.b('\nEXTERNAL LINKS OBSERVED — not candidates'));
    console.log(c.dim('  Linked from a trusted page, but ownership cannot be established mechanically.'));
    console.log(c.dim('  Listed for information only. None of these was fetched.'));
    for (const ex of result.externalLinks) {
      console.log(c.dim(`  ${ex.host}  (${ex.occurrences}) — ${ex.reason}`));
    }
  }

  if (result.notFound.length > 0) {
    console.log(c.b('\nCOVERAGE NOTE'));
    console.log(`  Some categories may require another official domain for this institution.`);
    console.log(`  Current allow-list: ${entry.allowedDomains.join(', ')}`);
    console.log(`  No approved source found for: ${result.notFound.join(', ')}`);
    console.log(c.dim('  Nothing outside the allow-list was fetched, and no domain was added automatically.'));
  }

  if (debug) {
    console.log(c.b('\nDEBUG — every candidate, in order'));
    for (const row of result.debug) {
      const mark = row.decision === 'accepted' ? c.g('✓') : row.decision === 'rejected' ? c.r('✗') : c.y('·');
      console.log(`  ${mark} [${row.stage}] ${row.url}`);
      console.log(c.dim(`      status: ${row.status ?? '—'}   type: ${row.contentType ?? '—'}   decision: ${row.decision}`));
      if (row.priority !== undefined) console.log(c.dim(`      fetch priority: ${row.priority}`));
      if (row.scores?.length) console.log(c.dim(`      scores: ${row.scores.join('  ')}`));
      if (row.role) console.log(c.dim(`      role: ${row.role}   audience: ${row.audience}   ${row.temporalStatus}`));
      if (row.reason) console.log(c.dim(`      reason: ${row.reason}`));
    }
  }

  if (result.status === 'failed') {
    console.log(c.y('\n  No pages classified. If this environment has no network access, that is expected.'));
  }

  entry.discovery = {
    status: result.status,
    lastAttemptedAt: new Date().toISOString(),
    notes: `${d.requests} requests, ${d.pagesClassified} pages classified, ${foundEntries.length}/${PAGE_KINDS.length} kinds found`,
  };
  saveRegistry(registry);
  console.log(c.dim(`\nregistry updated: ${REGISTRY_PATH}`));
  console.log(c.dim('Discovery records URLs only. No value has been extracted, and nothing has reached production data.'));
}

/* ------------------------------------------------------------------ */
/* Domain approval                                                     */
/* ------------------------------------------------------------------ */

function cmdAddDomain() {
  const registry = requireRegistry();
  const id = flag('university');
  const domain = flag('domain');
  if (!id || !domain || domain === true) {
    console.error(c.r('--university=<id> and --domain=<domain> are required'));
    process.exit(1);
  }
  const entry = getEntry(registry, assertSafeId(id));
  const scope = has('official') ? 'official' : 'subdomain';
  if (!has('yes')) {
    console.error(c.r('Refusing to widen an allow-list without --yes.'));
    console.error(c.dim(`  This would let ${domain} produce evidence for ${entry.officialName}.`));
    console.error(c.dim('  Check the domain really belongs to the institution first, then pass --yes.'));
    console.error(c.dim(`  --official allows every subdomain of it; the default approves just this host.`));
    process.exit(1);
  }
  const res = addDomain(entry, String(domain), { scope });
  saveRegistry(registry);
  console.log(res.already ? `${c.y('·')} ${res.domain} was already allowed` : `${c.g('✓')} ${res.domain} added as ${scope}`);
  console.log(c.dim(`  allow-list is now: ${entry.allowedDomains.join(', ')}`));
}

/* ------------------------------------------------------------------ */
/* Official-URL investigation                                          */
/* ------------------------------------------------------------------ */

/**
 * Mechanical variants of a URL that is not responding.
 *
 * Every variant is derived from the URL already in the dataset — dropping a
 * `www.`, adding one, or climbing to the parent host. None of them comes from
 * anything remembered about the institution, because a plausible-looking
 * replacement URL is precisely the failure this pipeline exists to prevent.
 */
function urlVariants(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return []; }
  const host = u.hostname.toLowerCase();
  const out = new Set();
  const add = (h) => { if (h && h.includes('.')) out.add(`https://${h}${u.pathname === '/' ? '' : u.pathname}`); };

  if (host.startsWith('www.')) add(host.slice(4));
  else add(`www.${host}`);

  // Climb one label at a time, keeping the registrable domain intact.
  const labels = host.split('.');
  const base = rootDomainOf(`https://${host}`);
  const baseLabels = base.split('.').length;
  for (let i = 1; labels.length - i >= baseLabels; i++) {
    add(labels.slice(i).join('.'));
    add(`www.${labels.slice(i).join('.')}`);
  }
  out.delete(`https://${host}${u.pathname === '/' ? '' : u.pathname}`);
  return [...out];
}

async function cmdProbeUrls() {
  const registry = requireRegistry();
  const onlyId = flag('university');
  const targets = onlyId ? [getEntry(registry, assertSafeId(onlyId))] : registry.universities;
  const curated = readCuratedUniversities();

  console.log(c.b('\nProbing officialUrl for each institution'));
  console.log(c.dim('  Variants are mechanical rewrites of the URL already on record. This command'));
  console.log(c.dim('  never proposes a URL from memory and never edits the dataset.\n'));

  const report = { checkedAt: new Date().toISOString(), ok: [], broken: [] };

  for (const entry of targets) {
    const u = curated.find((x) => x.id === entry.id);
    const url = u?.officialUrl ?? entry.officialRootUrl;
    if (!url) continue;
    const res = await safeFetch(url, entry.allowedDomains);
    const healthy = res.ok && !(res.text && looksLikeChallenge(res.text));
    if (healthy) {
      report.ok.push({ id: entry.id, url, status: res.status, finalUrl: res.url });
      console.log(`${c.g('OK')}      ${entry.id.padEnd(16)} ${url}${res.url !== url ? c.dim(`  -> ${res.url}`) : ''}`);
      continue;
    }

    const failure = res.ok ? 'bot challenge page' : res.reason;
    console.log(`${c.r('BROKEN')}  ${entry.id.padEnd(16)} ${url}`);
    console.log(c.dim(`          ${failure}`));

    const alternatives = [];
    for (const variant of urlVariants(url)) {
      // A variant on a host outside the allow-list is reported, never fetched.
      const allowed = entry.allowedDomains.some((d) => {
        try { const h = new URL(variant).hostname; return h === d || h.endsWith(`.${d}`); } catch { return false; }
      });
      if (!allowed) { alternatives.push({ url: variant, result: 'outside the approved domains for this institution' }); continue; }
      const vr = await safeFetch(variant, entry.allowedDomains);
      const vHealthy = vr.ok && !(vr.text && looksLikeChallenge(vr.text));
      alternatives.push({ url: variant, result: vHealthy ? `responds ${vr.status}` : (vr.reason ?? 'no response'), responds: vHealthy, finalUrl: vr.url });
      console.log(`          ${vHealthy ? c.g('responds') : c.dim('no')}  ${variant}${vHealthy && vr.url !== variant ? c.dim(`  -> ${vr.url}`) : ''}`);
    }

    report.broken.push({ id: entry.id, url, reason: failure, status: res.status, alternatives });
  }

  const out = join(DATA_DIR, 'url-probe-report.json');
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${c.g(String(report.ok.length))} reachable · ${c.r(String(report.broken.length))} broken`);
  console.log(c.dim(`report: ${out}`));
  if (report.broken.length) {
    console.log(c.b('\nWhat to do with a broken URL'));
    console.log('  1. Open the institution and confirm the real address yourself.');
    console.log('  2. Edit officialUrl in src/data/universities.ts.');
    console.log('  3. Run: npm run check:links');
    console.log(c.dim('  A variant that responds is a lead, not a confirmation. A parked domain answers 200 too.'));
  }
  if (report.broken.length > 0 && has('strict')) process.exit(1);
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
  else console.log(c.b('PROPOSED CHANGES\n'));

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
    console.log(c.b('REJECTED — a value was extracted and failed validation'));
    for (const r of proposals.rejected) console.log(`  ${c.r('✗')} ${r.field}: ${r.reason}`);
    console.log('');
  }

  if (proposals.noEvidence?.length) {
    console.log(c.b('NO EVIDENCE — the sources were read and say nothing about these'));
    console.log(c.dim('  These are not proposals. Nothing changes, and the existing value stands.'));
    for (const n of proposals.noEvidence) {
      console.log(`  ${c.dim('·')} ${n.field}${n.scope ? c.y(`   [source scope: ${n.scope}]`) : ''}`);
      console.log(c.dim(`      ${n.reason}`));
      if (n.url) console.log(c.dim(`      read: ${n.url}`));
    }
    console.log('');
  }

  if (proposals.excludedFigures?.length) {
    console.log(c.b('FIGURES FOUND AND NOT USED'));
    console.log(c.dim('  Monetary amounts on the page that are not what a student pays.'));
    for (const f of proposals.excludedFigures) {
      console.log(`  ${c.dim('·')} ${f.value}${f.currency ? ` ${f.currency}` : ''} not used as ${f.field}: ${f.reason}`);
      if (f.excerpt) console.log(c.dim(`      "${f.excerpt.slice(0, 140)}"`));
    }
    console.log('');
  }

  console.log(c.b('SUMMARY'));
  console.log(`  ${c.g(String(entries.filter((p) => p.verdict === VERDICT.ACCEPT).length))} accept`
    + `  ·  ${c.y(String(entries.filter((p) => p.verdict === VERDICT.REVIEW_REQUIRED).length))} review required`
    + `  ·  ${c.r(String(proposals.rejected?.length ?? 0))} rejected`
    + `  ·  ${c.dim(String(proposals.noEvidence?.length ?? 0))} no evidence\n`);

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
      const nonContent = isNonContentUrl(url);
      if (nonContent.nonContent) {
        // A sitemap recorded as a source page would hash cleanly forever and
        // look permanently healthy. Report it as broken, because it is.
        report.broken.push({ id: entry.id, kind, url, reason: `not a page: ${nonContent.reason}`, status: 0 });
        continue;
      }
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
  'add-domain': cmdAddDomain,
  'probe-urls': cmdProbeUrls,
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
  console.log('  discover        --university=<id> [--debug]   find official pages (needs network)');
  console.log('  add-domain      --university=<id> --domain=<d> [--official] --yes');
  console.log('  probe-urls      [--university=<id>] [--strict]  check officialUrl, suggest mechanical variants');
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
