'use client';

import { ArrowDown, ArrowUp, Globe2, Minus, RotateCcw, Sparkles, Wallet, X } from 'lucide-react';
import { UNIVERSITIES } from '@/data/universities';
import { COUNTRIES, type Country, type StudentProfile } from '@/lib/types';
import { BUDGET_OPTIONS, applyBudgetOption, nearestBudgetOption } from '@/lib/engine/whatif';
import type { WhatChanged } from '@/lib/engine/whatif';
import { Badge, Button, Card, Tooltip } from '@/components/ui';

/**
 * How many curated universities each country actually holds.
 *
 * Shown on every chip on purpose. Our dataset is 35 hand-checked institutions,
 * not a scrape, so some countries are thin — and a student deserves to know that
 * before they scope their whole search to one, rather than discovering it from a
 * short list they cannot explain.
 */
const COUNT_BY_COUNTRY = UNIVERSITIES.reduce<Record<string, number>>((acc, u) => {
  acc[u.country] = (acc[u.country] ?? 0) + 1;
  return acc;
}, {});

/** Countries the dataset actually covers, so no control leads to an empty result. */
const QUICK_COUNTRIES: Country[] = [
  'USA',
  'South Korea',
  'Hong Kong',
  'Singapore',
  'Germany',
  'Netherlands',
  'Italy',
  'United Kingdom',
  'UAE',
  'Kazakhstan',
];

export function WhatIfControls({
  profile,
  onChange,
  onReset,
  dirty,
}: {
  profile: StudentProfile;
  onChange: (p: StudentProfile) => void;
  onReset: () => void;
  dirty: boolean;
}) {
  const activeBudget = nearestBudgetOption(profile);
  const inScopeCount = profile.openToAnyCountry
    ? UNIVERSITIES.length
    : profile.preferredCountries.reduce((n, c) => n + (COUNT_BY_COUNTRY[c] ?? 0), 0);

  function toggleCountry(c: Country) {
    const has = profile.preferredCountries.includes(c);
    const nextCountries = has
      ? profile.preferredCountries.filter((x) => x !== c)
      : [...profile.preferredCountries, c];
    onChange({
      ...profile,
      preferredCountries: nextCountries,
      openToAnyCountry: nextCountries.length === 0,
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-soft px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-brand-600" strokeWidth={2} />
          <h2 className="text-[14px] font-semibold text-ink">What-if controls</h2>
          <Tooltip text="Change a parameter and the whole ranking recalculates instantly. Your saved profile is untouched until you apply the change." />
        </div>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={onReset}>
            <RotateCcw size={13} /> Reset
          </Button>
        )}
      </div>

      <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        {/* ---------------- Budget ---------------- */}
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Wallet size={14} className="text-muted" strokeWidth={2} />
            <h3 className="text-[13.5px] font-medium text-ink">Annual budget</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {BUDGET_OPTIONS.map((opt) => {
              const active = activeBudget.label === opt.label;
              return (
                <button
                  key={opt.label}
                  onClick={() => onChange(applyBudgetOption(profile, opt))}
                  title={opt.hint}
                  className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all duration-200 ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12.5px] leading-[1.55] text-muted">
            {activeBudget.hint}. Changing the budget also updates the funding requirement it implies —
            a family that can pay $25,000 a year does not need a full ride, and we say so rather than
            pretending nothing else moved.
          </p>
        </div>

        {/* ---------------- Country ---------------- */}
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 size={14} className="text-muted" strokeWidth={2} />
            <h3 className="text-[13.5px] font-medium text-ink">Destination</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onChange({ ...profile, preferredCountries: [], openToAnyCountry: true })}
              className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all duration-200 ${
                profile.openToAnyCountry
                  ? 'border-ink bg-ink text-white'
                  : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
              }`}
            >
              Anywhere
            </button>
            {QUICK_COUNTRIES.map((c) => {
              const active = !profile.openToAnyCountry && profile.preferredCountries.includes(c);
              const count = COUNT_BY_COUNTRY[c] ?? 0;
              return (
                <button
                  key={c}
                  onClick={() => toggleCountry(c)}
                  title={`${count} curated universit${count === 1 ? 'y' : 'ies'} in our dataset`}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-all duration-200 ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {c}
                  <span className={`tnum text-[11px] ${active ? 'text-white/60' : 'text-faint'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12.5px] leading-[1.55] text-muted">
            {profile.openToAnyCountry
              ? `All ${UNIVERSITIES.length} curated universities are in scope. The number on each chip is how many we hold for that country.`
              : `Scoped to ${profile.preferredCountries.join(', ')} — ${inScopeCount} universit${
                  inScopeCount === 1 ? 'y' : 'ies'
                } in our dataset. Options elsewhere stay visible but rank below every comparable in-scope one.`}
            {!profile.openToAnyCountry && inScopeCount < 3 && (
              <span className="mt-1 block text-warn-700">
                That is a thin slice of our curated set, so we widen the search to keep your list
                useful. Add a second country for a tighter result.
              </span>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* What changed panel                                                  */
/* ------------------------------------------------------------------ */

export function WhatChangedPanel({ diff, onDismiss }: { diff: WhatChanged; onDismiss: () => void }) {
  return (
    <Card className="ap-rise overflow-hidden border-brand-200">
      <div className="flex items-start justify-between gap-4 bg-brand-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
            <Sparkles size={13} strokeWidth={2.4} />
          </span>
          <div>
            <h3 className="text-[14.5px] font-semibold text-brand-700">What changed?</h3>
            <p className="mt-1 text-[13.5px] leading-[1.6] text-brand-700/85">{diff.headline}</p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-brand-700/60 transition-colors hover:bg-brand-100 hover:text-brand-700"
        >
          <X size={15} />
        </button>
      </div>

      {diff.noChange ? (
        <p className="px-5 py-4 text-[13.5px] leading-[1.6] text-muted">
          Nothing meaningful moved in your results. That is itself informative: this parameter is not the
          constraint binding your list — try the other one.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {diff.effects.map((e, i) => (
            <li key={i} className="flex items-start gap-2.5 px-5 py-3">
              <span
                className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  e.direction === 'up'
                    ? 'bg-good-50 text-good-700'
                    : e.direction === 'down'
                      ? 'bg-warn-50 text-warn-700'
                      : 'bg-surface-soft text-muted'
                }`}
              >
                {e.direction === 'up' ? (
                  <ArrowUp size={10} strokeWidth={3} />
                ) : e.direction === 'down' ? (
                  <ArrowDown size={10} strokeWidth={3} />
                ) : (
                  <Minus size={10} strokeWidth={3} />
                )}
              </span>
              <span className="text-[13.5px] leading-[1.55] text-ink-soft">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Small inline marker shown on cards that entered after a what-if change. */
export function NewBadge() {
  return <Badge tone="brand">New in your results</Badge>;
}

export { COUNTRIES };
