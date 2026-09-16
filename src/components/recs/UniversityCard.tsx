'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  GitCompareArrows,
  MapPin,
  Wallet,
} from 'lucide-react';
import { CATEGORY_LABELS, CATEGORY_TOOLTIP } from '@/lib/engine/explain';
import { formatUSD } from '@/lib/engine/utils';
import { useApp } from '@/lib/store';
import type { Recommendation } from '@/lib/types';
import { Badge, Button, Card, ScoreRing, Tooltip } from '@/components/ui';

const CATEGORY_TONE = {
  strong: 'good',
  possible: 'brand',
  ambitious: 'warn',
} as const;

const VERDICT = {
  'strong-financial-fit': { label: 'Strong financial fit', tone: 'good' as const },
  'potentially-affordable-with-aid': { label: 'Affordable with aid', tone: 'warn' as const },
  'above-budget': { label: 'Above budget', tone: 'risk' as const },
  unknown: { label: 'Cost unverified', tone: 'neutral' as const },
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

export function UniversityCard({ rec, rank }: { rec: Recommendation; rank?: number }) {
  const { compareIds, toggleCompare } = useApp();
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
            <Badge tone={verdict.tone}>
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

      {/* ---- actions ---- */}
      <div className="mt-5 flex items-center gap-2">
        <Button size="sm" variant="secondary" href={`/university/${u.id}`} className="flex-1">
          View details <ArrowUpRight size={13} />
        </Button>
        <Button
          size="sm"
          variant={inCompare ? 'primary' : 'quiet'}
          onClick={() => toggleCompare(u.id)}
          disabled={compareFull}
          title={compareFull ? 'You can compare up to four universities at a time' : undefined}
        >
          {inCompare ? <Check size={13} strokeWidth={2.6} /> : <GitCompareArrows size={13} />}
          {inCompare ? 'Comparing' : 'Compare'}
        </Button>
      </div>
    </Card>
  );
}
