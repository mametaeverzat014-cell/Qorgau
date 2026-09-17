/**
 * University registry.
 *
 * The registry is the pipeline's root of trust. It says, per institution, which
 * domains may speak for it. Discovery can propose URLs and fetching can follow
 * redirects, but nothing outside these domains can ever become evidence.
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
      /** Only these domains may produce evidence for this institution. */
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
      'allowedDomains is the root of trust for ingestion. A document from any other domain cannot become evidence, even if an official page links to it.',
    universities: entries,
  };
}

export function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveRegistry(registry) {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
  return REGISTRY_PATH;
}

export function getEntry(registry, id) {
  const e = registry.universities.find((u) => u.id === id);
  if (!e) throw new Error(`unknown university id "${id}" — not in the registry`);
  return e;
}
