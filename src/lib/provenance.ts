/**
 * Evidence-aware provenance layer.
 *
 * WHY THIS EXISTS
 * ---------------
 * The recommendation engine reads flat fields (`estimatedTuition.value`,
 * `minimumIELTS`, `fullRidePossible`). That is fast, testable and stays exactly
 * as it is. What it cannot do is answer the one question that decides the
 * highest-weighted judging criterion:
 *
 *     "Where did this number come from?"
 *
 * This module adds that answer alongside the value, without touching the shape
 * the engine depends on. A field with no evidence keeps behaving exactly as it
 * does today; a field the ingestion pipeline has processed gains a URL, a
 * retrieval timestamp, an academic year and an honest verification status.
 *
 * DESIGN CONSTRAINT
 * -----------------
 * Additive only. `University` gains one optional `evidence` bag. No existing
 * field changes type, so no existing test or engine path is affected.
 */

/* ------------------------------------------------------------------ */
/* Verification status                                                 */
/* ------------------------------------------------------------------ */

/**
 * How much weight a value can carry.
 *
 * The ordering matters and is enforced by the pipeline: a transformation can
 * only ever *lower* a status, never raise it. Deriving a total from an
 * unverified part yields an unverified total.
 */
export type VerificationStatus =
  /** Extracted from a first-party official source, with evidence attached. */
  | 'verified'
  /** Computed from other values on this record; inherits the weakest input. */
  | 'derived'
  /** Compiled by hand from public materials at curation time; no live re-check. */
  | 'curated'
  /** Not established. The value must be null. */
  | 'unverified';

export const STATUS_RANK: Record<VerificationStatus, number> = {
  verified: 3,
  derived: 2,
  curated: 1,
  unverified: 0,
};

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  verified: 'Verified',
  derived: 'Derived',
  curated: 'Curated',
  unverified: 'Unverified',
};

export const STATUS_TOOLTIPS: Record<VerificationStatus, string> = {
  verified:
    'Extracted from this institution’s own official page or document, with the source and retrieval date recorded.',
  derived:
    'Computed from other values on this record. It is only as reliable as the weakest value it was computed from, and those are listed.',
  curated:
    'Compiled by hand from public materials when the dataset was assembled, and not re-verified against the live page since.',
  unverified:
    'We could not establish this value, so we show nothing rather than inventing a plausible number.',
};

/* ------------------------------------------------------------------ */
/* Source evidence                                                     */
/* ------------------------------------------------------------------ */

/**
 * Source hierarchy. Tier 1 is the institution speaking about itself; Tier 2 is
 * an official body speaking about it. Nothing else may back a decision-critical
 * value — a search result is a way to *find* a source, never the source.
 */
export type SourceType =
  | 'common_data_set'
  | 'official_pdf'
  | 'official_web'
  | 'government'
  | 'other_official';

/** Higher wins when two official sources disagree. */
export const SOURCE_TYPE_RANK: Record<SourceType, number> = {
  common_data_set: 5,
  official_pdf: 4,
  official_web: 3,
  government: 2,
  other_official: 1,
};

export interface SourceEvidence {
  /** Absolute https URL on an allow-listed official domain. */
  url: string;
  title?: string;
  publisher?: string;
  /** ISO 8601 timestamp of when the document was fetched. */
  retrievedAt: string;
  /** e.g. "2026-27". Required for anything cycle-specific: costs, deadlines. */
  academicYear?: string;
  sourceType: SourceType;
  /** Page number for PDF evidence, so a reviewer can find the claim. */
  page?: number;
  /** The text the value was read from. Kept short; it is quoted in review. */
  excerpt?: string;
  /** SHA-256 of the fetched body, used to detect that a source has changed. */
  contentHash?: string;
}

/* ------------------------------------------------------------------ */
/* Verified value                                                      */
/* ------------------------------------------------------------------ */

export interface VerifiedValue<T> {
  /** `null` whenever status is 'unverified'. Enforced by assertValidVerifiedValue. */
  value: T | null;
  status: VerificationStatus;
  /** Empty for curated/unverified; non-empty for verified. */
  evidence: SourceEvidence[];
  /** 0-1. Extractor confidence. Never on its own enough to reach 'verified'. */
  confidence?: number;
  /** For 'derived': the field names this was computed from. */
  derivedFrom?: string[];
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Constructors                                                        */
/* ------------------------------------------------------------------ */

export function verified<T>(
  value: T,
  evidence: SourceEvidence[],
  opts: { confidence?: number; notes?: string } = {},
): VerifiedValue<T> {
  if (evidence.length === 0) {
    // A 'verified' value with no evidence is precisely the failure mode this
    // module exists to prevent.
    throw new Error('verified() requires at least one piece of source evidence');
  }
  return { value, status: 'verified', evidence, ...opts };
}

export function curated<T>(value: T | null, notes?: string): VerifiedValue<T> {
  return { value, status: 'curated', evidence: [], notes };
}

export function unverified<T>(notes?: string): VerifiedValue<T> {
  return { value: null, status: 'unverified', evidence: [], notes };
}

/**
 * Computes a value from others, inheriting the weakest input status.
 *
 * This is the rule that stops laundering: summing a verified tuition and an
 * unverified housing figure cannot produce a verified total.
 */
export function derive<T>(
  value: T | null,
  inputs: { field: string; source: VerifiedValue<unknown> }[],
  notes?: string,
): VerifiedValue<T> {
  const weakest = inputs.reduce<VerificationStatus>(
    (worst, i) => (STATUS_RANK[i.source.status] < STATUS_RANK[worst] ? i.source.status : worst),
    'verified',
  );
  const anyMissing = inputs.some((i) => i.source.value === null);
  const status: VerificationStatus =
    anyMissing || weakest === 'unverified' ? 'unverified' : weakest === 'verified' ? 'derived' : weakest;

  return {
    value: status === 'unverified' ? null : value,
    status,
    // A derived value carries the union of its inputs' evidence, so a reviewer
    // can still reach every underlying document.
    evidence: inputs.flatMap((i) => i.source.evidence),
    derivedFrom: inputs.map((i) => i.field),
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* Invariants                                                          */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * The invariants that make a status meaningful. Violations are errors, not
 * warnings: a mislabelled status is worse than a missing value.
 */
export function assertValidVerifiedValue(
  field: string,
  v: VerifiedValue<unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (v.status === 'unverified' && v.value !== null) {
    issues.push({
      field,
      severity: 'error',
      message: 'status is unverified but a value is present; unverified values must be null',
    });
  }

  if (v.status === 'verified') {
    if (v.evidence.length === 0) {
      issues.push({ field, severity: 'error', message: 'status is verified but no evidence is attached' });
    }
    if (v.value === null) {
      issues.push({ field, severity: 'error', message: 'status is verified but the value is null' });
    }
  }

  if (v.status === 'derived' && (!v.derivedFrom || v.derivedFrom.length === 0)) {
    issues.push({ field, severity: 'error', message: 'status is derived but no source fields are recorded' });
  }

  if (v.confidence !== undefined && (v.confidence < 0 || v.confidence > 1)) {
    issues.push({ field, severity: 'error', message: `confidence ${v.confidence} is outside 0-1` });
  }

  for (const [i, e] of v.evidence.entries()) {
    if (!/^https:\/\//.test(e.url)) {
      issues.push({ field, severity: 'error', message: `evidence[${i}] url is not https: ${e.url}` });
    }
    if (Number.isNaN(Date.parse(e.retrievedAt))) {
      issues.push({ field, severity: 'error', message: `evidence[${i}] retrievedAt is not a valid date` });
    }
    if (e.academicYear && !/^\d{4}-\d{2}$/.test(e.academicYear)) {
      issues.push({
        field,
        severity: 'error',
        message: `evidence[${i}] academicYear "${e.academicYear}" is not in YYYY-YY form`,
      });
    }
  }

  return issues;
}

/** Best available evidence for display: strongest source type, then most recent. */
export function primaryEvidence(v: VerifiedValue<unknown>): SourceEvidence | null {
  if (v.evidence.length === 0) return null;
  return [...v.evidence].sort(
    (a, b) =>
      SOURCE_TYPE_RANK[b.sourceType] - SOURCE_TYPE_RANK[a.sourceType] ||
      Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt),
  )[0];
}

/**
 * Resolves disagreement between two official sources for the same field.
 *
 * Returns the stronger source type; if the type ties, the newer academic year;
 * if that ties too, returns null so the field goes to human review rather than
 * silently picking one.
 */
export function reconcile<T>(
  a: VerifiedValue<T>,
  b: VerifiedValue<T>,
): { winner: VerifiedValue<T> | null; reason: string } {
  if (a.value === b.value) return { winner: a, reason: 'sources agree' };

  const ea = primaryEvidence(a);
  const eb = primaryEvidence(b);
  if (!ea || !eb) return { winner: ea ? a : b, reason: 'only one side carries evidence' };

  const rank = SOURCE_TYPE_RANK[ea.sourceType] - SOURCE_TYPE_RANK[eb.sourceType];
  if (rank !== 0) {
    return {
      winner: rank > 0 ? a : b,
      reason: `${rank > 0 ? ea.sourceType : eb.sourceType} outranks ${rank > 0 ? eb.sourceType : ea.sourceType}`,
    };
  }

  const ya = ea.academicYear ?? '';
  const yb = eb.academicYear ?? '';
  if (ya !== yb && (ya || yb)) {
    return { winner: ya > yb ? a : b, reason: `newer academic year (${ya > yb ? ya : yb})` };
  }

  return {
    winner: null,
    reason: 'two equally authoritative sources disagree; escalating to human review',
  };
}

/* ------------------------------------------------------------------ */
/* Per-university evidence bag                                         */
/* ------------------------------------------------------------------ */

/**
 * Field-level evidence attached to a university record.
 *
 * Optional by design: absent means "curated", which is what the UI already
 * communicates. The pipeline fills this in field by field as sources are
 * verified, so the dataset can improve incrementally without a migration.
 */
export interface UniversityEvidence {
  tuition?: VerifiedValue<number>;
  livingCost?: VerifiedValue<number>;
  totalCostOfAttendance?: VerifiedValue<number>;
  minimumIELTS?: VerifiedValue<number>;
  minimumTOEFL?: VerifiedValue<number>;
  satPolicy?: VerifiedValue<string>;
  applicationDeadline?: VerifiedValue<string>;
  scholarshipDeadline?: VerifiedValue<string>;
  applicationPlatform?: VerifiedValue<string>;
  needBasedAidForInternationals?: VerifiedValue<boolean>;
  meetsFullNeedForInternationals?: VerifiedValue<boolean>;
  fullTuitionPossible?: VerifiedValue<boolean>;
  fullRidePossible?: VerifiedValue<boolean>;
}

export const EVIDENCE_FIELDS = [
  'tuition',
  'livingCost',
  'totalCostOfAttendance',
  'minimumIELTS',
  'minimumTOEFL',
  'satPolicy',
  'applicationDeadline',
  'scholarshipDeadline',
  'applicationPlatform',
  'needBasedAidForInternationals',
  'meetsFullNeedForInternationals',
  'fullTuitionPossible',
  'fullRidePossible',
] as const satisfies readonly (keyof UniversityEvidence)[];

/** Validates every populated field in an evidence bag. */
export function validateEvidenceBag(bag: UniversityEvidence): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of EVIDENCE_FIELDS) {
    const v = bag[field];
    if (v) issues.push(...assertValidVerifiedValue(field, v as VerifiedValue<unknown>));
  }
  return issues;
}

/** How much of a record is backed by first-party evidence. */
export function evidenceCoverage(bag: UniversityEvidence | undefined): {
  verified: number;
  total: number;
  percent: number;
} {
  const total = EVIDENCE_FIELDS.length;
  if (!bag) return { verified: 0, total, percent: 0 };
  const verifiedCount = EVIDENCE_FIELDS.filter((f) => {
    const v = bag[f] as VerifiedValue<unknown> | undefined;
    return v?.status === 'verified';
  }).length;
  return { verified: verifiedCount, total, percent: Math.round((verifiedCount / total) * 100) };
}
