/** Type declarations for the pipeline stages. */

import type { Registry } from './registry.d.mts';
import type { DiscoveryResult } from './discovery.d.mts';
import type { FetchResult } from './safety.d.mts';

export function sha256(buf: Uint8Array | string): string;

export function discover(
  registry: Registry,
  id: string,
  opts?: {
    log?: (line: string) => void;
    debug?: boolean;
    fetchImpl?: (url: string, domains: string[], opts?: { accept?: string }) => Promise<FetchResult>;
  },
): Promise<DiscoveryResult & { requests: number }>;

export interface RawDocument {
  kind: string;
  url: string;
  file: string;
  contentType?: string;
  bytes: number;
  contentHash: string;
  retrievedAt: string;
}
export interface FetchManifest {
  id: string;
  fetchedAt: string;
  documents: RawDocument[];
  failures: Array<{ kind: string; url: string; reason?: string; status: number }>;
}
export function fetchPages(
  registry: Registry,
  id: string,
  opts?: { log?: (line: string) => void },
): Promise<FetchManifest>;

export interface ExcludedFigure {
  field: string;
  value: number;
  currency: string | null;
  reason: string;
  excerpt?: string;
  url?: string;
}
export interface MissingEvidence {
  field: string;
  reason: string;
  url?: string;
  kind?: string;
}
export interface ExtractionResult {
  id: string;
  extractedAt: string;
  candidates: Record<string, unknown[]>;
  notes: string[];
  /** Monetary figures found on the page and deliberately not used. */
  excludedFigures: ExcludedFigure[];
  /** Fields the documents were silent on. Not the same as false. */
  noEvidence: MissingEvidence[];
  /** How many documents had site chrome stripped before extraction. */
  contentCleaned: number;
}
export function extractFrom(
  id: string,
  manifest: FetchManifest,
  opts?: { log?: (line: string) => void },
): ExtractionResult;

export interface Proposal {
  field: string;
  value: unknown;
  verdict: string;
  confidence: number | null;
  evidence: Array<{
    url: string;
    title?: string;
    retrievedAt: string;
    sourceType: string;
    contentHash?: string;
    academicYear?: string | null;
    excerpt?: string;
  }>;
  issues: Array<{ field: string; severity: string; message: string }>;
  status: string;
}
export interface ValidationResult {
  id: string;
  validatedAt: string;
  proposals: Record<string, Proposal>;
  rejected: Array<{ field: string; reason: string; issues: unknown[] }>;
  /** Fields no source spoke to. Distinct from a rejected candidate. */
  noEvidence: MissingEvidence[];
  excludedFigures: ExcludedFigure[];
  consistency: unknown[];
}
export function validateCandidates(
  id: string,
  extracted: ExtractionResult,
  opts?: { log?: (line: string) => void },
): ValidationResult;

export function loadApproved(id: string): Record<string, unknown> | null;
export function saveApproved(id: string, data: unknown): string;
export function loadProposals(id: string): ValidationResult | null;
export function listApprovedIds(): string[];
