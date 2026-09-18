/** Type declarations for the validation layer. */

import type { AidSignals, DeadlineCandidate, IeltsCandidate, MoneyCandidate, ScoreCandidate } from './extract.mjs';

export interface Issue {
  field: string;
  /** `info` is a provenance note; it never changes a verdict. */
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function validateMoneyCandidate(field: string, c: Partial<MoneyCandidate> | null | undefined): Issue[];
export function validateIELTS(candidates: IeltsCandidate[] | null | undefined): { value: number | null; issues: Issue[] };
export function validateTOEFL(candidates: ScoreCandidate[] | null | undefined): { value: number | null; issues: Issue[] };
export function validateDeadline(
  field: string,
  candidates: DeadlineCandidate[] | null | undefined,
  cycle?: { from: string; to: string },
): { value: string | null; issues: Issue[] };

export const EVIDENCE: {
  SUPPORTED: 'SUPPORTED';
  CONTRADICTED: 'CONTRADICTED';
  UNKNOWN: 'UNKNOWN';
};
export type EvidenceState = 'SUPPORTED' | 'CONTRADICTED' | 'UNKNOWN';

export interface EvidenceFor<T> {
  state: EvidenceState;
  /** The value the source supports or contradicts; null when UNKNOWN. */
  value: T | null;
  reason: string;
}

export type AidCertainty = 'meets-full-need' | 'structural' | 'competitive' | 'minimal';

/** Plain values, `null` wherever the source says nothing either way. */
export interface AidFlags {
  needBasedAidForInternationals: boolean | null;
  meetsFullNeedForInternationals: boolean | null;
  fullTuitionPossible: boolean | null;
  fullRidePossible: boolean | null;
  aidCertainty: AidCertainty | null;
}

export interface AidEvidence {
  needBasedAidForInternationals: EvidenceFor<boolean>;
  meetsFullNeedForInternationals: EvidenceFor<boolean>;
  fullTuitionPossible: EvidenceFor<boolean>;
  fullRidePossible: EvidenceFor<boolean>;
  aidCertainty: EvidenceFor<AidCertainty>;
}

export function deriveAidFlags(signals: AidSignals): {
  flags: AidFlags;
  evidence: AidEvidence;
  issues: Issue[];
};

export const SCOPE_GUARDED_FIELDS: string[];
export function scopeMayServeField(
  field: string,
  scope: string,
): { ok: boolean; reason: string | null };

export function validateRecordConsistency(rec: Record<string, unknown>): Issue[];

export const VERDICT: {
  ACCEPT: 'ACCEPT'; REVIEW_REQUIRED: 'REVIEW_REQUIRED'; REJECT: 'REJECT'; NO_EVIDENCE: 'NO_EVIDENCE';
};
export function verdictFor(input: {
  issues: Issue[];
  hasEvidence: boolean;
  confidence?: number;
}): { verdict: 'ACCEPT' | 'REVIEW_REQUIRED' | 'REJECT'; errors: Issue[]; reason: string };
