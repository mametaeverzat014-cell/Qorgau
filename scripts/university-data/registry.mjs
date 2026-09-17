/**
 * University registry.
 *
 * The registry is the pipeline's root of trust. It says, per institution, which
 * domains may speak for it. Discovery can propose URLs and fetching can follow
 * redirects, but nothing outside these domains can ever become evidence.
 *
 * Institutions rarely live on one domain. Admissions, the registrar, student
 * financial services and institutional research are often separate hosts, and
 * sometimes separate registrable domains altogether. The model therefore has
 * two lists:
 *
 *   officialDomains     registrable domains the institution owns; any subdomain
 *                       of one of these may produce evidence
 *   trustedSubdomains   individual hostnames on domains the institution does
 *                       not own outright, approved one at a time
 *
 * `allowedDomains` is the union of the two and is what the fetch layer reads.
 * It is derived, never hand-edited, and recomputed on every load and save.
 * Adding a domain is a human decision: `cli.mjs add-domain --yes`. Nothing in
 * discovery can widen the allow-list on its own.
 *
 * Entries are seeded from the officialUrl already present in the curated
 * dataset. Known page URLs start empty on purpose: this environment has no
 * network access, and inventing an admissions URL is exactly the mistake that
 * put 404ing links into production once already. Discovery fills them in when
 * the pipeline is run somewhere with connectivity.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeId } from './safety.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..');
export const DATA_DIR = join(ROOT, 'data');
export const REGISTRY_PATH = join(DATA_DIR, 'registry', 'universities.registry.json');

/** Page kinds the pipeline knows how to look for and extract from. */
export const PAGE_KINDS = [
  'admissions',
  'international_admissions',
  'tuition',
  'cost_of_attendance',
  'financial_aid',
  'international_financial_aid',
  'scholarships',
  'testing_policy',
  'english_requirements',
  'deadlines',
  'programs',
  'common_data_set',
];

/**
 * Reads the curated dataset without importing TypeScript.
 *
 * Deliberately a narrow regex over the source rather than a TS build step: the
 * pipeline is a plain-node tool and should not need the app's toolchain to run.
 */
export function readCuratedUniversities() {
  const src = readFileSync(join(ROOT, 'src', 'data', 'universities.ts'), 'utf8');
  const out = [];
  for (const block of src.split(/(?=\n  \{\n    id: ')/)) {
    const id = block.match(/\n?\s*id: '([a-z0-9-]+)'/)?.[1];
    if (!id) continue;
    const pick = (key) => block.match(new RegExp(`\\n\\s*${key}: '([^']*)'`))?.[1] ?? null;
    const pickNum = (key) => {
      const m = block.match(new RegExp(`\\n\\s*${key}: (-?\\d+(?:\\.\\d+)?|null)`));
      return m ? (m[1] === 'null' ? null : Number(m[1])) : null;
    };
    const pickBool = (key) => {
      const m = block.match(new RegExp(`\\n\\s*${key}: (true|false|null)`));
      return m ? (m[1] === 'null' ? null : m[1] === 'true') : null;
    };
    const money = (key) => {
      const m = block.match(new RegExp(`${key}: EST\\((-?\\d+|null)`));
      return m ? (m[1] === 'null' ? null : Number(m[1])) : null;
    };
    out.push({
      id,
      name: pick('name'),
      shortName: pick('shortName'),
      country: pick('country'),
      region: pick('region'),
      officialUrl: pick('officialUrl'),
      tuition: money('estimatedTuition'),
      livingCost: money('estimatedLivingCost'),
      minimumIELTS: pickNum('minimumIELTS'),
      minimumTOEFL: pickNum('minimumTOEFL'),
      satPolicy: pick('satPolicy'),
      applicationDeadline: pick('applicationDeadline'),
      scholarshipDeadline: pick('scholarshipDeadline'),
      applicationPlatform: pick('applicationPlatform'),
      fullRidePossible: pickBool('fullRidePossible'),
      fullTuitionPossible: pickBool('fullTuitionPossible'),
      needBasedAidForInternationals: pickBool('needBasedAidForInternationals'),
      aidCertainty: pick('aidCertainty'),
      compiledOn: pick('compiledOn'),
    });
  }
  return out;
}

/** Registrable domain of a URL, used to seed the allow-list. */
export function rootDomainOf(url) {
  const host = new URL(url).hostname.toLowerCase();
  const parts = host.split('.');
  // Handle two-part public suffixes (ac.uk, edu.sg, ac.kr, edu.pl, edu.au...).
  const twoPart = new Set(['ac', 'edu', 'gov', 'co', 'or', 'ne', 'com']);
  if (parts.length >= 3 && twoPart.has(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

/**
 * The union of official domains and individually trusted subdomains.
 *
 * Legacy entries that only carry `allowedDomains` are read as if that list were
 * `officialDomains`, so an older registry file keeps working unchanged.
 */
export function resolveAllowedDomains(entry) {
  const official = entry.officialDomains ?? entry.allowedDomains ?? [];
  const subs = entry.trustedSubdomains ?? [];
  return [...new Set([...official, ...subs].map((d) => String(d).toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '')))]
    .filter(Boolean);
}

/** Migrates an entry to the two-list domain model and recomputes allowedDomains. */
export function normalizeEntry(entry) {
  entry.officialDomains ??= [...(entry.allowedDomains ?? [])];
  entry.trustedSubdomains ??= [];
  entry.allowedDomains = resolveAllowedDomains(entry);
  return entry;
}

/**
 * Rejects anything that is not a plain public domain name.
 *
 * The allow-list is the only thing standing between the fetcher and the rest of
 * the network, so a bad entry here is worth more than a bad entry anywhere else
 * in the pipeline.
 */
export function assertPlausibleDomain(domain) {
  const d = String(domain).toLowerCase().trim();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) {
    throw new Error(`"${domain}" is not a domain name`);
  }
  if (d.split('.').length < 2) throw new Error(`"${domain}" has no public suffix`);
  if (/^\d+(\.\d+)*$/.test(d)) throw new Error(`"${domain}" looks like an IP address`);
  for (const bad of ['localhost', 'local', 'internal', 'test', 'invalid', 'example']) {
    if (d === bad || d.endsWith(`.${bad}`)) throw new Error(`"${domain}" is not a public domain`);
  }
  return d;
}

/**
 * Adds a domain to an institution's allow-list.
 *
 * `scope` is "official" for a registrable domain the institution owns (its
 * subdomains are then allowed too) or "subdomain" for a single approved host.
 */
export function addDomain(entry, domain, { scope = 'subdomain' } = {}) {
  const d = assertPlausibleDomain(domain);
  normalizeEntry(entry);
  const list = scope === 'official' ? entry.officialDomains : entry.trustedSubdomains;
  const already = entry.allowedDomains.includes(d);
  if (!list.includes(d)) list.push(d);
  entry.allowedDomains = resolveAllowedDomains(entry);
  return { domain: d, scope, already };
}

/** Builds a registry skeleton from the curated dataset. */
export function buildRegistry() {
  const entries = readCuratedUniversities().map((u) => {
    assertSafeId(u.id);
    const domain = rootDomainOf(u.officialUrl);
    return {
      id: u.id,
      officialName: u.name,
      shortName: u.shortName,
      country: u.country,
      region: u.region,
      /**
       * Registrable domains this institution owns. Seeded from the one domain
       * the curated officialUrl points at — deliberately not expanded from
       * memory. Real institutions have more; a human adds them with
       * `add-domain` once they have checked the domain really is official.
       */
      officialDomains: [domain],
      /** Individually approved hostnames outside officialDomains. */
      trustedSubdomains: [],
      /** Derived union; the fetch layer reads this. Never hand-edit. */
      allowedDomains: [domain],
      officialRootUrl: u.officialUrl,
      /**
       * Known page URLs. Empty until discovery runs with real connectivity —
       * we do not guess admissions paths.
       */
      pages: Object.fromEntries(PAGE_KINDS.map((k) => [k, null])),
      discovery: {
        status: 'pending',
        lastAttemptedAt: null,
        notes: 'No discovery run yet. Requires outbound network access.',
      },
    };
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      'allowedDomains is derived from officialDomains + trustedSubdomains and is the root of trust for ingestion. A document from any other domain cannot become evidence, even if an official page links to it. Widening the list is a human decision (cli.mjs add-domain --yes).',
    universities: entries,
  };
}

export function loadRegistry() {
  try {
    const r = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    for (const e of r.universities ?? []) normalizeEntry(e);
    return r;
  } catch {
    return null;
  }
}

export function saveRegistry(registry) {
  for (const e of registry.universities ?? []) normalizeEntry(e);
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  return REGISTRY_PATH;
}

export function getEntry(registry, id) {
  const e = registry.universities.find((u) => u.id === id);
  if (!e) throw new Error(`unknown university id "${id}" — not in the registry`);
  return normalizeEntry(e);
}
