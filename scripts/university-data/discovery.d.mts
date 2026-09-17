/** Type declarations for page discovery. */

import type { FetchResult } from './safety.d.mts';
import type { RegistryEntry } from './registry.d.mts';

export function normalise(s: unknown): string;
export function hasTerm(haystack: string, term: string): boolean;

export function isNonContentUrl(rawUrl: string): { nonContent: boolean; reason: string | null };
export function isSitemapUrl(rawUrl: string): boolean;

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}
export function parseSitemap(xml: string | null): {
  kind: 'index' | 'urlset' | 'unknown';
  entries: SitemapEntry[];
};
export function parseRobotsSitemaps(text: string | null): string[];

export type SourceRole = 'canonical' | 'supporting' | 'fallback' | 'historical';
export type Audience = 'first_year' | 'transfer' | 'graduate' | 'international' | 'all_undergraduate' | 'unknown';
export type TemporalStatus = 'current' | 'dated' | 'historical' | 'unknown';

export interface Temporal {
  publishedDate: string | null;
  updatedDate: string | null;
  academicYear: string | null;
  academicYearAmbiguous?: boolean;
  temporalStatus: TemporalStatus;
  temporalReasons?: string[];
}

export interface KindSignals {
  decisionCritical?: boolean;
  audienceSensitive?: boolean;
  require?: string[][];
  requireOneOf?: string[][];
  coRequire?: [string[], string[]];
  hardNegative?: string[];
  canonical?: string[];
  path?: string[];
  title?: string[];
  heading?: string[];
  text?: string[];
  negative?: string[];
  pdfPhrases?: string[];
}
export const KIND_SIGNALS: Record<string, KindSignals>;
export const CANDIDATE_PATHS: Record<string, string[]>;
export const ACCEPT_THRESHOLD: number;
export const MIN_CONTENT_SIGNAL: number;
export const FALLBACK_MIN: number;
export const NON_CANONICAL_SEGMENTS: string[];
export const DISCOVERY_LIMITS: {
  maxSitemapFetches: number;
  maxSitemapDepth: number;
  maxSitemapUrls: number;
  maxContentFetches: number;
  maxCandidatesPerKind: number;
};

export function scoreUrlPath(rawUrl: string, kind: string): { score: number; matched: string[] };
export function pathSegments(url: string): string[];
export function pathAuthority(rawUrl: string, kind: string): {
  score: number; reasons: string[]; canonicalHits: string[]; blogPath: boolean;
};
export function detectAudience(doc?: { url?: string; title?: string; headingList?: string[] }): Audience;
export function currentAcademicYear(now?: Date): string;
export function pageDates(html?: string, url?: string): { publishedDate: string | null; updatedDate: string | null };
export function detectTemporal(
  doc?: { html?: string; url?: string; text?: string; blogLike?: boolean },
  now?: Date,
): Temporal;
export function coOccurs(
  groupA: string[],
  groupB: string[],
  ctx?: { title?: string; sections?: Array<{ heading?: string; body?: string }>; text?: string; windowChars?: number },
): { ok: boolean; where: string | null; excerpt: string | null; matched: { a: string; b: string } | null };
export function scoreAuthority(kind: string, doc?: DocumentInput, now?: Date): {
  score: number; reasons: string[]; role: SourceRole; blogLike: boolean; audience: Audience; temporal: Temporal;
};
export function candidatePriority(url: string, kind: string): {
  score: number; relevance: number; authority: number; audience: Audience; blogPath: boolean;
};
export interface LinkedHost {
  host: string;
  occurrences: number;
  examples: string[];
  anchors: string[];
  reason: string;
  linkedFrom?: string;
}
export function collectDomainCandidates(
  html: string,
  ctx: { allowedDomains: string[]; nameTokens: string[] },
): { candidates: LinkedHost[]; external: LinkedHost[] };
export function isAcademicHost(host: string): boolean;
export function registrableDomain(host: string): string;
export function isInstitutionalCandidate(
  host: string,
  ctx: { nameTokens: string[] },
): { ok: boolean; reason: string };
export function institutionTokens(entry: Partial<RegistryEntry>): string[];
export function normalizeUrl(raw: string): string;
export function compareCandidates(a: KindScore, b: KindScore): number;
export function whyItWon(winner: KindScore, loser?: KindScore | null): string;

export interface DocumentInput {
  url?: string;
  title?: string;
  headingList?: string[];
  text?: string;
  html?: string;
  sections?: Array<{ heading?: string; body?: string }>;
  sitemapContext?: string;
  audience?: Audience;
  temporal?: Temporal;
}
export interface KindScore {
  kind: string;
  score: number;
  relevance?: number;
  authority?: number;
  content: number;
  accepted: boolean;
  role?: SourceRole;
  audience?: Audience;
  temporal?: Temporal;
  coOccurrence?: { ok: boolean; where: string | null } | null;
  reasons: string[];
  contentSignal?: string;
}
export function scoreKind(kind: string, doc?: DocumentInput, now?: Date): KindScore;
export function classifyDocument(doc: DocumentInput, now?: Date): KindScore[];

export function pdfTitle(buffer: Uint8Array | null | undefined): string | null;
export function classifyPdf(doc: { url: string; title: string | null }, now?: Date): KindScore[];

export interface DiscoveredPage {
  url: string;
  title: string | null;
  score: number;
  relevanceScore: number;
  authorityScore: number;
  sourceRole: SourceRole;
  audience: Audience;
  temporal: Temporal;
  temporalStatus: TemporalStatus;
  publishedDate: string | null;
  updatedDate: string | null;
  reasons: string[];
  whySelected: string;
  runnerUp: { url: string; score: number; role: SourceRole; audience: Audience; whyItLost: string } | null;
  alternatives: number;
  contentType?: string;
  academicYear: string | null;
  retrievedAt: string;
  contentSignal: string;
  requiresManualReading: boolean;
  discoveredVia: string;
}
export interface DiscoveryDiagnostics {
  robotsSitemaps: string[];
  sitemapsFetched: number;
  sitemapUrlsDiscovered: number;
  nonContentUrlsSkipped: number;
  candidatesConsidered: number;
  candidatesSkippedForBudget: number;
  duplicatePagesSkipped: number;
  pagesFetched: number;
  pagesClassified: number;
  chromeStrippedPages: number;
  requests: number;
  budgetExhausted: boolean;
}
export interface DebugRow {
  url: string;
  stage: string;
  status?: number;
  contentType?: string;
  title?: string | null;
  decision: string;
  scores?: string[];
  priority?: number;
  role?: SourceRole;
  audience?: Audience;
  temporalStatus?: TemporalStatus;
  reason?: string | null;
}
export interface DiscoveryResult {
  found: Record<string, DiscoveredPage>;
  notFound: string[];
  rejectedForQuality: Array<{ kind: string; url: string; role: SourceRole; score: number; reason: string }>;
  fallbacks: Record<string, DiscoveredPage>;
  domainCandidates: LinkedHost[];
  externalLinks: LinkedHost[];
  manualReview: Array<{ url: string; title: string | null; retrievedAt: string; contentType?: string; reason: string }>;
  diagnostics: DiscoveryDiagnostics;
  debug: DebugRow[];
  status: 'complete' | 'partial' | 'failed';
}

export function discoverPages(
  entry: RegistryEntry,
  opts?: {
    fetchImpl?: (url: string, domains: string[], opts?: { accept?: string }) => Promise<FetchResult>;
    log?: (line: string) => void;
    debug?: boolean;
    limits?: typeof DISCOVERY_LIMITS;
    maxRequests?: number;
    now?: Date;
  },
): Promise<DiscoveryResult>;
