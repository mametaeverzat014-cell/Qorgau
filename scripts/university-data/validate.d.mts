/** Type declarations for the validation layer. */

import type { AidSignals, DeadlineCandidate, IeltsCandidate, MoneyCandidate, ScoreCandidate } from './extract.mjs';

export interface Issue {
  field: string;
  severity: 'error' | 'warning';
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

export interface AidFlags {
  needBasedAidForInternationals: boolean;
  meetsFullNeedForInternationals: boolean;
  fullTuitionPossible: boolean;
  fullRidePossible: boolean;
  aidCertainty: 'meets-full-need' | 'structural' | 'competitive' | 'minimal';
}
export function deriveAidFlags(signals: AidSignals): { flags: AidFlags; issues: Issue[] };

export function validateRecordConsistency(rec: Record<string, unknown>): Issue[];

export const VERDICT: { ACCEPT: 'ACCEPT'; REVIEW_REQUIRED: 'REVIEW_REQUIRED'; REJECT: 'REJECT' };
export function verdictFor(input: {
  issues: Issue[];
  hasEvidence: boolean;
  confidence?: number;
}): { verdict: 'ACCEPT' | 'REVIEW_REQUIRED' | 'REJECT'; errors: Issue[]; reason: string };
