'use client';

import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui';
import {
  primaryEvidence,
  STATUS_LABELS,
  STATUS_TOOLTIPS,
  type VerificationStatus,
  type VerifiedValue,
} from '@/lib/provenance';

const TONE: Record<VerificationStatus, 'good' | 'brand' | 'neutral' | 'warn'> = {
  verified: 'good',
  derived: 'brand',
  curated: 'brand',
  unverified: 'warn',
};

/**
 * Compact provenance for a single fact.
 *
 * Deliberately small. Recommendation cards must stay scannable, so the badge is
 * the whole footprint there; the source link, academic year and check date only
 * appear where there is room for them, on the university detail page.
 */
export function FactProvenance({
  value,
  showSource = false,
  className = '',
}: {
  value: VerifiedValue<unknown> | undefined;
  /** Detail pages pass true; cards leave it false. */
  showSource?: boolean;
  className?: string;
}) {
  // No evidence recorded means the value came from hand curation, which is what
  // the record-level provenance already communicates. Say nothing extra.
  if (!value) return null;

  const evidence = primaryEvidence(value);
  const label = STATUS_LABELS[value.status];

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <Badge tone={TONE[value.status]} title={STATUS_TOOLTIPS[value.status]}>
        {label}
      </Badge>

      {evidence?.academicYear && (
        <span className="tnum text-[11.5px] text-faint" title="The academic year this figure applies to">
          {evidence.academicYear}
        </span>
      )}

      {value.status === 'derived' && value.derivedFrom?.length ? (
        <span className="text-[11.5px] text-faint" title={`Computed from ${value.derivedFrom.join(' + ')}`}>
          from {value.derivedFrom.join(' + ')}
        </span>
      ) : null}

      {showSource && evidence && (
        <>
          <a
            href={evidence.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[11.5px] font-medium text-brand-600 transition-colors hover:text-brand-700"
            title={evidence.title ?? evidence.url}
          >
            Source
            <ExternalLink size={10} className="shrink-0" />
          </a>
          <span className="text-[11.5px] text-faint" title={`Retrieved ${evidence.retrievedAt}`}>
            checked{' '}
            {new Date(evidence.retrievedAt).toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
              timeZone: 'UTC',
            })}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Summary of how much of a record is source-backed.
 *
 * Shown on the detail page so a judge can see at a glance whether this
 * institution has been through ingestion or is still hand-curated.
 */
export function EvidenceCoverageBadge({ verified, total }: { verified: number; total: number }) {
  if (verified === 0) {
    return (
      <Badge
        tone="neutral"
        title="No automated ingestion has run for this institution yet, so every field is hand-curated. The pipeline exists; it has not been pointed at this record."
      >
        Hand-curated record
      </Badge>
    );
  }
  return (
    <Badge tone="good" title={`${verified} of ${total} decision-critical fields are backed by an official source`}>
      {verified}/{total} fields source-backed
    </Badge>
  );
}
