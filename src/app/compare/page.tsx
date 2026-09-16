'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { ArrowLeft, Crown, GitCompareArrows, Printer, X } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Button, Card, EmptyState, PageSkeleton, ScoreRing, Tooltip } from '@/components/ui';
import { buildComparison, comparisonTakeaways, winnerOf } from '@/lib/engine/compare';
import { CATEGORY_LABELS, CATEGORY_TOOLTIP } from '@/lib/engine/explain';
import { calculateOverallMatch } from '@/lib/engine/score';
import { getUniversity } from '@/data/universities';
import { useApp } from '@/lib/store';

const CATEGORY_TONE = { strong: 'good', possible: 'brand', ambitious: 'warn' } as const;

export default function ComparePage() {
  const router = useRouter();
  const { ready, hasProfile, profile, compareIds, toggleCompare, clearCompare } = useApp();

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  const recs = useMemo(
    () =>
      compareIds
        .map((id) => getUniversity(id))
        .filter((u): u is NonNullable<typeof u> => Boolean(u))
        .map((u) => calculateOverallMatch(profile, u)),
    [compareIds, profile],
  );

  const rows = useMemo(() => (recs.length >= 2 ? buildComparison(recs) : []), [recs]);
  const takeaways = useMemo(() => (recs.length >= 2 ? comparisonTakeaways(recs) : []), [recs]);

  if (!ready || !hasProfile) return <PageSkeleton />;

  if (recs.length < 2) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[720px] px-5 py-16">
          <EmptyState
            icon={<GitCompareArrows size={20} />}
            title={recs.length === 0 ? 'Nothing selected to compare yet' : 'Pick one more university'}
            body={
              recs.length === 0
                ? 'Choose two to four universities from your recommendations and we will put them side by side on the dimensions that actually decide between them — cost after aid, programme availability, entry requirements and deadlines.'
                : 'A comparison needs at least two universities. Add one more from your recommendations and this page will fill in.'
            }
            action={
              <Button href="/recommendations">
                <ArrowLeft size={14} /> Go to recommendations
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
        <div className="ap-rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              Side-by-side comparison
            </h1>
            <p className="mt-3 text-[15.5px] leading-[1.65] text-ink-soft">
              {recs.length} universities across {rows.length} dimensions. Where one option is clearly
              better for <em className="not-italic font-medium text-ink">your</em> profile, we mark it —
              so this is a decision aid, not a repeat of the cards.
            </p>
          </div>
          <div className="ap-no-print flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </Button>
            <Button variant="secondary" size="sm" onClick={clearCompare}>
              Clear all
            </Button>
            <Button size="sm" href="/recommendations">
              Add more
            </Button>
          </div>
        </div>

        {/* ---------------- Takeaways ---------------- */}
        <div className="mt-8 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(recs.length, 4)}, minmax(0, 1fr))` }}>
          {takeaways.map((t) => {
            const rec = recs.find((r) => r.university.id === t.id)!;
            return (
              <Card key={t.id} className="p-4">
                <div className="flex items-start gap-2">
                  <Crown size={14} className="mt-[3px] shrink-0 text-brand-500" strokeWidth={2.2} />
                  <p className="text-[13px] leading-[1.6] text-ink-soft">{t.text}</p>
                </div>
                <p className="mt-2 text-[12px] text-faint">{rec.university.country}</p>
              </Card>
            );
          })}
        </div>

        {/* ---------------- Table ---------------- */}
        <Card className="mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-soft">
                  <th className="sticky left-0 z-10 w-[190px] bg-surface-soft px-5 py-4 align-bottom text-[12px] font-semibold uppercase tracking-[0.07em] text-faint">
                    Dimension
                  </th>
                  {recs.map((rec) => (
                    <th key={rec.university.id} className="px-5 py-4 align-bottom">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/university/${rec.university.id}`}
                            className="block text-[14.5px] font-semibold leading-[1.35] text-ink transition-colors hover:text-brand-600"
                          >
                            {rec.university.shortName}
                          </Link>
                          <span className="mt-1.5 inline-block">
                            <Badge tone={CATEGORY_TONE[rec.category]}>
                              {CATEGORY_LABELS[rec.category]}
                            </Badge>
                          </span>
                        </div>
                        <div className="ap-no-print flex flex-col items-center gap-1">
                          <ScoreRing score={rec.score} size={40} />
                          <button
                            onClick={() => toggleCompare(rec.university.id)}
                            aria-label={`Remove ${rec.university.shortName} from comparison`}
                            className="rounded p-0.5 text-faint transition-colors hover:text-risk-500"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const winner = winnerOf(row);
                  return (
                    <tr key={row.key} className="border-b border-line last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-surface px-5 py-3.5 text-[13px] font-medium text-muted"
                      >
                        <span className="flex items-center gap-1.5">
                          {row.label}
                          {row.key === 'match' && <Tooltip text={CATEGORY_TOOLTIP} />}
                          {row.key === 'netcost' && (
                            <Tooltip text="The lowest annual cost we can justify from this university's published aid policy. It is a best case, not a quotation." />
                          )}
                        </span>
                      </th>
                      {row.values.map((v) => {
                        const isWinner = winner === v.id;
                        return (
                          <td
                            key={v.id}
                            title={v.note}
                            className={`px-5 py-3.5 text-[13.5px] leading-[1.5] ${
                              isWinner ? 'bg-good-50 font-semibold text-good-700' : 'text-ink-soft'
                            }`}
                          >
                            <span className={row.key.includes('cost') || row.key === 'tuition' || row.key === 'living' || row.key === 'match' ? 'tnum' : ''}>
                              {v.display}
                            </span>
                            {isWinner && (
                              <span className="ml-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-good-500">
                                best
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <p className="mt-4 text-[12.5px] leading-[1.65] text-muted">
          &ldquo;Best&rdquo; marks the strongest option <em className="not-italic font-medium">among the
          universities you selected</em>, on that dimension alone. It does not mean the university is the
          right overall choice — read the takeaways above and each university&rsquo;s detail page before
          deciding. Cost figures are indicative estimates; confirm them at the official source links.
        </p>

        <div className="ap-no-print mt-8 flex flex-wrap gap-2">
          <Button variant="secondary" href="/recommendations">
            <ArrowLeft size={14} /> Back to recommendations
          </Button>
          <Button href="/roadmap">Build these into my roadmap</Button>
        </div>
      </div>
    </AppShell>
  );
}
