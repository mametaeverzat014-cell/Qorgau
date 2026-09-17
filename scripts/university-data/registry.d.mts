/** Type declarations for the university registry. */

export const ROOT: string;
export const DATA_DIR: string;
export const REGISTRY_PATH: string;
export const PAGE_KINDS: string[];

export interface CuratedUniversity {
  id: string;
  name: string | null;
  shortName: string | null;
  country: string | null;
  region: string | null;
  officialUrl: string;
  tuition: number | null;
  livingCost: number | null;
  minimumIELTS: number | null;
  minimumTOEFL: number | null;
  satPolicy: string | null;
  applicationDeadline: string | null;
  scholarshipDeadline: string | null;
  applicationPlatform: string | null;
  fullRidePossible: boolean | null;
  fullTuitionPossible: boolean | null;
  needBasedAidForInternationals: boolean | null;
  aidCertainty: string | null;
  compiledOn: string | null;
}

export interface RegistryEntry {
  id: string;
  officialName: string | null;
  shortName: string | null;
  country: string | null;
  region: string | null;
  /** Registrable domains the institution owns; subdomains are allowed. */
  officialDomains: string[];
  /** Individually approved hostnames outside officialDomains. */
  trustedSubdomains: string[];
  /** Derived union of the two lists. The fetch layer reads this. */
  allowedDomains: string[];
  officialRootUrl: string;
  pages: Record<string, string | null>;
  discovery: { status: string; lastAttemptedAt: string | null; notes: string };
}

export interface Registry {
  version: number;
  generatedAt: string;
  note: string;
  universities: RegistryEntry[];
}

export function readCuratedUniversities(): CuratedUniversity[];
export function rootDomainOf(url: string): string;
export function buildRegistry(): Registry;
export function loadRegistry(): Registry | null;
export function saveRegistry(registry: Registry): string;
export function getEntry(registry: Registry, id: string): RegistryEntry;
export function resolveAllowedDomains(entry: Partial<RegistryEntry>): string[];
export function normalizeEntry(entry: Partial<RegistryEntry>): RegistryEntry;
export function assertPlausibleDomain(domain: string): string;
export function addDomain(
  entry: RegistryEntry,
  domain: string,
  opts?: { scope?: 'official' | 'subdomain' },
): { domain: string; scope: string; already: boolean };
