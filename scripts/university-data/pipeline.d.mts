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

export interface ExtractionResult {
  id: string;
  extractedAt: string;
  candidates: Record<string, unknown[]>;
  notes: string[];
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
  evidence: unknown[];
  issues: Array<{ field: string; severity: string; message: string }>;
  status: string;
}
export interface ValidationResult {
  id: string;
  validatedAt: string;
  proposals: Record<string, Proposal>;
  rejected: Array<{ field: string; reason: string; issues: unknown[] }>;
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
