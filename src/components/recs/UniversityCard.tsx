'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  GitCompareArrows,
  MapPin,
  Wallet,
} from 'lucide-react';
import { MATCH_WEIGHTS } from '@/lib/weights';
import { CATEGORY_LABELS, CATEGORY_TOOLTIP } from '@/lib/engine/explain';
import { formatUSD } from '@/lib/engine/utils';
import { useApp } from '@/lib/store';
import type { Recommendation } from '@/lib/types';
import { Badge, Button, Card, ProgressBar, ScoreRing, Tooltip } from '@/components/ui';

const CATEGORY_TONE = {
  strong: 'good',
  possible: 'brand',
  ambitious: 'warn',
} as const;

const VERDICT: Record<
  Recommendation['fits']['financial']['verdict'],
  { label: string; tone: 'good' | 'warn' | 'risk' | 'neutral'; hint: string }
> = {
  'strong-financial-fit': {
    label: 'Strong financial fit',
    tone: 'good',
    hint: 'The estimated cost already sits inside what you said your family can pay. No scholarship is strictly required.',
  },
  'potentially-affordable-with-aid': {
    label: 'Affordable with aid',
    tone: 'warn',
    hint: 'Needs funding, but this university either meets the full demonstrated need of admitted international students or is low-cost by default — so the support is dependable rather than a contest.',
  },
  'aid-dependent': {
    label: 'Aid-dependent',
    tone: 'risk',
    hint: 'Only works if you win a competitive award. A limited number are granted each year, so do not build your plan on this option alone.',
  },
  'above-budget': {
    label: 'Above budget',
    tone: 'risk',
    hint: 'Out of reach even at the most favourable realistic aid outcome we can justify from published policy.',
  },
  unknown: {
    label: 'Cost unverified',
    tone: 'neutral',
    hint: 'We could not verify cost data for this university, so affordability here is unknown.',
  },
};

export function deadlineDisplay(date: string | null) {
  if (!date) return 'Not published';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Days until a deadline; negative when passed. */
export function daysUntil(date: string | null, now = new Date()) {
  if (!date) return null;
  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - now.getTime()) / 86_400_000);
}

const COMPONENT_ROWS: { key: keyof typeof MATCH_WEIGHTS; label: string }[] = [
  { key: 'financial', label: 'Financial fit' },
  { key: 'academic', label: 'Academic alignment' },
  { key: 'major', label: 'Programme match' },
  { key: 'geography', label: 'Location fit' },
  { key: 'scholarship', label: 'Scholarship compatibility' },
  { key: 'preference', label: 'Your preferences' },
  { key: 'tests', label: 'Entry requirements' },
];

export function UniversityCard({ rec, rank }: { rec: Recommendation; rank?: number }) {
  const { compareIds, toggleCompare } = useApp();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const u = rec.university;
  const fin = rec.fits.financial;
  const verdict = VERDICT[fin.verdict];
  const inCompare = compareIds.includes(u.id);
  const compareFull = compareIds.length >= 4 && !inCompare;
  const days = daysUntil(u.applicationDeadline);

  // Two or three reasons is the readable limit on a card; the detail page has all of them.
  const reasons = rec.reasons.slice(0, 3);
  const concerns = rec.concerns.slice(0, 2);

  return (
    <Card hover className="flex h-full flex-col p-5">
      {/* ---- header ---- */}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={CATEGORY_TONE[rec.category]}>{CATEGORY_LABELS[rec.category]}</Badge>
            <Tooltip text={CATEGORY_TOOLTIP} />
            {rank !== undefined && (
              <span className="tnum text-[12px] font-semibold text-faint">#{rank}</span>
            )}
            {rec.outsidePreferredCountries && (
              <Badge tone="neutral" title="Shown because your in-country options were limited.">
                Outside your countries
              </Badge>
            )}
          </div>
          <h3 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.015em] text-ink">
            <Link href={`/university/${u.id}`} className="transition-colors hover:text-brand-600">
              {u.name}
            </Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-[13px] text-muted">
            <MapPin size={12.5} strokeWidth={2} /> {u.city}, {u.country}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={rec.score} size={52} />
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint">Match</span>
        </div>
      </div>

      {/* ---- key facts ---- */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3.5">
        <div>
          <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-faint">Your major</p>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {rec.fits.major.score >= 90 ? (
              <span className="flex items-center gap-1 text-good-700">
                <Check size={12.5} strokeWidth={2.6} /> Offered
              </span>
            ) : rec.fits.major.score >= 50 ? (
              'Related programme'
            ) : (
              <span className="text-warn-700">Not offered</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-faint">
            Best case / year
          </p>
          <p className="tnum mt-1 text-[13px] font-medium text-ink">
            {formatUSD(fin.bestCaseNetCost)}
            {fin.totalAnnualCost !== null && fin.bestCaseNetCost !== fin.totalAnnualCost && (
              <span className="ml-1 text-[11.5px] font-normal text-faint line-through">
                {formatUSD(fin.totalAnnualCost)}
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-faint">Affordability</p>
          <p className="mt-1">
            <Badge tone={verdict.tone} title={verdict.hint}>
              <Wallet size={11} strokeWidth={2.2} /> {verdict.label}
            </Badge>
          </p>
        </div>
        <div>
          <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-faint">Deadline</p>
          <p className="mt-1 flex items-center gap-1 text-[13px] font-medium text-ink">
            <CalendarDays size={12.5} strokeWidth={2} className="text-faint" />
            {deadlineDisplay(u.applicationDeadline)}
            {days !== null && days >= 0 && days <= 60 && (
              <span className="text-[11.5px] font-semibold text-warn-700">({days}d)</span>
            )}
          </p>
        </div>
      </div>

      {/* ---- why it matches ---- */}
      <div className="mt-4 flex-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint">
          Why it matches you
        </p>
        <ul className="mt-2 space-y-1.5">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-[1.55] text-ink-soft">
              <Check size={13} strokeWidth={2.6} className="mt-[3px] shrink-0 text-good-500" />
              <span>{r}</span>
            </li>
          ))}
        </ul>

        {concerns.length > 0 && (
          <>
            <p className="mt-3.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-faint">
              Watch out
            </p>
            <ul className="mt-2 space-y-1.5">
              {concerns.map((c, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-[1.55] text-ink-soft">
                  <AlertTriangle size={13} strokeWidth={2.2} className="mt-[3px] shrink-0 text-warn-500" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ---- score breakdown: collapsed so the card stays scannable ---- */}
      <div className="mt-4 border-t border-line pt-3">
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
          className="flex w-full items-center justify-between gap-2 text-left text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
        >
          <span>Why {rec.score}%? See the seven scores</span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform duration-200 ${showBreakdown ? 'rotate-180' : ''}`}
          />
        </button>

        {showBreakdown && (
          <div className="ap-fade mt-3 space-y-2">
            {COMPONENT_ROWS.map(({ key, label }) => {
              const value = rec.components[key];
              return (
                <div key={key}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-ink-soft">
                      {label}
                      <span className="ml-1.5 text-[11px] text-faint">
                        {Math.round(MATCH_WEIGHTS[key] * 100)}%
                      </span>
                    </span>
                    <span className="tnum text-[12px] font-semibold text-ink">{value}</span>
                  </div>
                  <ProgressBar
                    percent={value}
                    tone={value >= 75 ? 'good' : value >= 50 ? 'brand' : 'ink'}
                    height={4}
                  />
                </div>
              );
            })}
            <p className="pt-1 text-[11.5px] leading-[1.5] text-faint">
              Each dimension is scored independently, then combined with the fixed weights shown.
              This measures alignment with your profile — it is not a probability of admission.
            </p>
          </div>
        )}
      </div>

      {/* ---- actions ---- */}
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant="secondary" href={`/university/${u.id}`} className="flex-1">
          View details <ArrowUpRight size={13} />
        </Button>
        <Button
          size="sm"
          variant={inCompare ? 'primary' : 'quiet'}
          onClick={() => toggleCompare(u.id)}
          disabled={compareFull}
          title={
            compareFull
              ? 'Your comparison already holds four universities. Remove one to add this.'
              : inCompare
                ? 'Remove from comparison'
                : 'Add to comparison'
          }
        >
          {inCompare ? <Check size={13} strokeWidth={2.6} /> : <GitCompareArrows size={13} />}
          {inCompare ? 'Comparing' : compareFull ? 'Compare full' : 'Compare'}
        </Button>
      </div>
    </Card>
  );
}
