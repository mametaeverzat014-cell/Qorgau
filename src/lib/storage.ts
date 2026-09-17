import { EMPTY_PROFILE } from './demo';
import {
  COUNTRIES,
  MAJORS,
  type AidNeed,
  type CitySize,
  type ClassRank,
  type Country,
  type Curriculum,
  type EnglishTest,
  type GpaScale,
  type MajorKey,
  type PreferenceWeights,
  type StudentProfile,
  type UniversitySize,
  type CampusEnvironment,
} from './types';

/**
 * Persistence boundary.
 *
 * Everything the product remembers lives in the browser, which means the stored
 * value is user-editable, survives across deploys, and can be left behind by an
 * older build. Parsing it is therefore an untrusted-input problem, not a
 * convenience.
 *
 * The previous implementation only guarded against invalid JSON. Valid JSON of
 * the wrong shape went straight into React state, and a measured sweep found
 * seven of eight corruption cases crashing the app outright — a profile stored
 * as `null`, a compare list stored as an object, a profile missing
 * `preferredCountries`. Each produced an uncaught TypeError on render.
 *
 * Every reader below therefore validates field by field and falls back to a
 * known-good default. A corrupt value can cost the student their saved answers;
 * it can never take the application down.
 */

/** Bumped whenever the persisted shape changes incompatibly. */
export const STORAGE_VERSION = 2;

export const STORAGE_KEYS = {
  version: 'admitpath.version',
  profile: 'admitpath.profile.v1',
  tasks: 'admitpath.tasks.v1',
  shortlist: 'admitpath.shortlist.v1',
  compare: 'admitpath.compare.v1',
} as const;

/* ------------------------------------------------------------------ */
/* Primitive coercion                                                  */
/* ------------------------------------------------------------------ */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Finite numbers only — NaN and Infinity would poison every downstream score. */
const num = (v: unknown, fallback: number, min?: number, max?: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
};

const nullableNum = (v: unknown, min?: number, max?: number): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (min !== undefined && v < min) return null;
  if (max !== undefined && v > max) return null;
  return v;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const stringArray = (v: unknown, max = 50): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : [];

const enumArray = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x))))
    : [];

/* ------------------------------------------------------------------ */
/* Domain validation                                                   */
/* ------------------------------------------------------------------ */

const CURRICULA: Curriculum[] = ['National', 'IB', 'A-Level', 'AP / US High School', 'Other'];
const GPA_SCALES: GpaScale[] = ['4.0', '5.0', '100', 'IB45', 'ALevel'];
const CLASS_RANKS: ClassRank[] = ['top-1', 'top-5', 'top-10', 'top-25', 'other', 'unknown'];
const ENGLISH_TESTS: EnglishTest[] = ['IELTS', 'TOEFL', 'Duolingo', 'none'];
const AID_NEEDS: AidNeed[] = ['full-ride', 'full-tuition', 'partial', 'none'];
const CITY_SIZES: (CitySize | 'no-preference')[] = [
  'metropolis',
  'large-city',
  'mid-size-city',
  'college-town',
  'no-preference',
];
const ENVIRONMENTS: (CampusEnvironment | 'no-preference')[] = [
  'urban',
  'suburban',
  'campus-town',
  'no-preference',
];
const SIZES: (UniversitySize | 'no-preference')[] = ['small', 'medium', 'large', 'no-preference'];

function sanitizePreferences(v: unknown): PreferenceWeights {
  const d = EMPTY_PROFILE.preferences;
  if (!isRecord(v)) return { ...d };
  return {
    research: num(v.research, d.research, 0, 100),
    prestige: num(v.prestige, d.prestige, 0, 100),
    scholarship: num(v.scholarship, d.scholarship, 0, 100),
    location: num(v.location, d.location, 0, 100),
    campusLife: num(v.campusLife, d.campusLife, 0, 100),
  };
}

/**
 * Rebuilds a valid profile from arbitrary input. Never throws, always returns
 * something the engine can score.
 */
export function sanitizeProfile(raw: unknown): StudentProfile {
  const d = EMPTY_PROFILE;
  if (!isRecord(raw)) return { ...d };

  const budget = num(raw.budgetAnnualUSD, d.budgetAnnualUSD, 0, 10_000_000);
  // The ceiling is meaningless below the comfortable budget; clamp rather than
  // trusting a stored pair that contradicts itself.
  const ceiling = Math.max(budget, num(raw.maxAffordableAnnualUSD, d.maxAffordableAnnualUSD, 0, 10_000_000));

  const preferredCountries = enumArray<Country>(raw.preferredCountries, COUNTRIES);

  return {
    name: str(raw.name, d.name).slice(0, 60),
    currentCountry: str(raw.currentCountry, d.currentCountry).slice(0, 60),
    gradeYear: str(raw.gradeYear, d.gradeYear).slice(0, 40),
    graduationYear: num(raw.graduationYear, d.graduationYear, 2000, 2100),
    curriculum: oneOf(raw.curriculum, CURRICULA, d.curriculum),
    gpaValue: nullableNum(raw.gpaValue, 0, 100),
    gpaScale: oneOf(raw.gpaScale, GPA_SCALES, d.gpaScale),
    classRank: oneOf(raw.classRank, CLASS_RANKS, d.classRank),

    englishTest: oneOf(raw.englishTest, ENGLISH_TESTS, d.englishTest),
    englishScore: nullableNum(raw.englishScore, 0, 200),
    englishPlanned: bool(raw.englishPlanned, d.englishPlanned),

    satTaken: bool(raw.satTaken, d.satTaken),
    satScore: nullableNum(raw.satScore, 400, 1600),
    actTaken: bool(raw.actTaken, d.actTaken),
    actScore: nullableNum(raw.actScore, 1, 36),

    strongestSubjects: stringArray(raw.strongestSubjects, 10),
    academicInterests: stringArray(raw.academicInterests, 10),
    intendedMajor: oneOf<MajorKey>(raw.intendedMajor, MAJORS, d.intendedMajor),

    preferredCountries,
    // Restores the invariant the questionnaire enforces: "open to anywhere" is
    // true exactly when no country is selected. A stored pair that contradicts
    // itself is repaired rather than trusted.
    openToAnyCountry: preferredCountries.length === 0,

    citySizePreference: oneOf(raw.citySizePreference, CITY_SIZES, d.citySizePreference),
    environmentPreference: oneOf(raw.environmentPreference, ENVIRONMENTS, d.environmentPreference),
    sizePreference: oneOf(raw.sizePreference, SIZES, d.sizePreference),
    englishTaughtOnly: bool(raw.englishTaughtOnly, d.englishTaughtOnly),

    budgetAnnualUSD: budget,
    maxAffordableAnnualUSD: ceiling,
    aidNeed: oneOf(raw.aidNeed, AID_NEEDS, d.aidNeed),

    preferences: sanitizePreferences(raw.preferences),

    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
  };
}

/** Task completion map: string keys to true. Anything else is discarded. */
export function sanitizeTaskMap(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k === 'string' && k.length > 0 && k.length < 200 && v === true) out[k] = true;
  }
  return out;
}

/** University id lists (shortlist, comparison). Deduplicated and length-capped. */
export function sanitizeIdList(raw: unknown, max = 20): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(raw.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,60}$/.test(x))),
  ).slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Browser access                                                      */
/* ------------------------------------------------------------------ */

/** Reads and validates a key. Any failure yields the caller's fallback. */
function read<T>(key: string, sanitize: (raw: unknown) => T): T {
  if (typeof window === 'undefined') return sanitize(undefined);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return sanitize(undefined);
    return sanitize(JSON.parse(raw));
  } catch {
    // Unparseable, or storage blocked entirely (private mode, disabled cookies).
    return sanitize(undefined);
  }
}

export function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota exceeded or storage blocked — the session stays fully usable. */
  }
}

/**
 * Discards persisted state written by an incompatible earlier version, so an
 * old shape can never reach the current engine.
 */
export function ensureStorageVersion(): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEYS.version));
    if (stored === STORAGE_VERSION) return;
    for (const key of [
      STORAGE_KEYS.profile,
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.shortlist,
      STORAGE_KEYS.compare,
    ]) {
      window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(STORAGE_KEYS.version, String(STORAGE_VERSION));
  } catch {
    /* Storage unavailable; nothing to migrate. */
  }
}

export const readProfile = () => read(STORAGE_KEYS.profile, sanitizeProfile);
export const readTaskMap = () => read(STORAGE_KEYS.tasks, sanitizeTaskMap);
export const readShortlist = () => read(STORAGE_KEYS.shortlist, (r) => sanitizeIdList(r, 40));
export const readCompare = () => read(STORAGE_KEYS.compare, (r) => sanitizeIdList(r, 4));

export function clearAllStoredData(): void {
  if (typeof window === 'undefined') return;
  try {
    Object.values(STORAGE_KEYS).forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
