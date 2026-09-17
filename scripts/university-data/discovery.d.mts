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

export interface KindSignals {
  require?: string[][];
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
export const DISCOVERY_LIMITS: {
  maxSitemapFetches: number;
  maxSitemapDepth: number;
  maxSitemapUrls: number;
  maxContentFetches: number;
  maxCandidatesPerKind: number;
};

export function scoreUrlPath(rawUrl: string, kind: string): { score: number; matched: string[] };

export interface DocumentInput {
  url?: string;
  title?: string;
  headingList?: string[];
  text?: string;
  sitemapContext?: string;
}
export interface KindScore {
  kind: string;
  score: number;
  content: number;
  accepted: boolean;
  reasons: string[];
  contentSignal?: string;
}
export function scoreKind(kind: string, doc?: DocumentInput): KindScore;
export function classifyDocument(doc: DocumentInput): KindScore[];

export function pdfTitle(buffer: Uint8Array | null | undefined): string | null;
export function classifyPdf(doc: { url: string; title: string | null }): KindScore[];

export interface DiscoveredPage {
  url: string;
  title: string | null;
  score: number;
  reasons: string[];
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
  pagesFetched: number;
  pagesClassified: number;
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
  reason?: string | null;
}
export interface DiscoveryResult {
  found: Record<string, DiscoveredPage>;
  notFound: string[];
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
  },
): Promise<DiscoveryResult>;
