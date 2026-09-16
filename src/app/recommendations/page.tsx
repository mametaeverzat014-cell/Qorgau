'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitCompareArrows, Info, Pencil, SearchX } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { UniversityCard } from '@/components/recs/UniversityCard';
import { WhatChangedPanel, WhatIfControls } from '@/components/recs/WhatIfControls';
import { Badge, Button, Card, EmptyState, PageSkeleton, Tooltip } from '@/components/ui';
import { CATEGORY_TOOLTIP } from '@/lib/engine/explain';
import { getRecommendations } from '@/lib/engine/score';
import { diffRecommendations, type WhatChanged } from '@/lib/engine/whatif';
import { useApp } from '@/lib/store';
import type { StudentProfile } from '@/lib/types';

export default function RecommendationsPage() {
  const router = useRouter();
  const {
    ready,
    hasProfile,
    profile: savedProfile,
    recommendations: savedSet,
    setProfile,
    compareIds,
  } = useApp();

  /* The what-if profile is a local overlay: the saved profile is only touched
     when the student explicitly applies the change. */
  const [draft, setDraft] = useState<StudentProfile | null>(null);
  const [diff, setDiff] = useState<WhatChanged | null>(null);

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  const activeProfile = draft ?? savedProfile;
  const set = useMemo(
    () => (draft ? getRecommendations(draft) : savedSet),
    [draft, savedSet],
  );

  function applyWhatIf(next: StudentProfile) {
    const before = { profile: activeProfile, set };
    const after = { profile: next, set: getRecommendations(next) };
    setDiff(diffRecommendations(before, after));
    setDraft(next);
  }

  function reset() {
    setDraft(null);
    setDiff(null);
  }

  if (!ready || !hasProfile) return <PageSkeleton />;

  const enteredIds = new Set(diff?.entered.map((r) => r.university.id) ?? []);
  const strong = set.results.filter((r) => r.category === 'strong').length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
        {/* ---------------- Header ---------------- */}
        <div className="ap-rise flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              Your university recommendations
            </h1>
            <p className="mt-3 text-[15.5px] leading-[1.65] text-ink-soft">
              {set.results.length} options ranked against your profile
              {strong > 0 && `, ${strong} of them strong matches`}. Every score below describes{' '}
              <em className="not-italic font-medium text-ink">alignment with what you told us</em> — never
              your chance of admission.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" href="/onboarding">
              <Pencil size={14} /> Edit profile
            </Button>
            <Button href="/compare">
              <GitCompareArrows size={15} />
              {compareIds.length > 0 ? `Compare (${compareIds.length})` : 'Compare'}
            </Button>
          </div>
        </div>

        {/* ---------------- What-if ---------------- */}
        <section className="mt-8">
          <WhatIfControls
            profile={activeProfile}
            onChange={applyWhatIf}
            onReset={reset}
            dirty={draft !== null}
          />
        </section>

        {diff && (
          <section className="mt-4">
            <WhatChangedPanel diff={diff} onDismiss={() => setDiff(null)} />
          </section>
        )}

        {/* ---------------- Unsaved-change bar ---------------- */}
        {draft !== null && (
          <div className="ap-fade mt-4 flex flex-col items-start justify-between gap-3 rounded-[12px] border border-line bg-surface px-5 py-3.5 sm:flex-row sm:items-center">
            <p className="text-[13.5px] leading-[1.55] text-ink-soft">
              You&rsquo;re previewing changed parameters. Your saved profile, roadmap and progress are
              unchanged until you apply them.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setProfile({ ...draft, completedAt: savedProfile.completedAt });
                  setDraft(null);
                }}
              >
                Apply to my profile <ArrowRight size={13} />
              </Button>
            </div>
          </div>
        )}

        {/* ---------------- Notice ---------------- */}
        {set.notice && (
          <Card className="mt-4 flex gap-3 border-warn-500/25 bg-warn-50 p-4">
            <Info size={16} className="mt-[2px] shrink-0 text-warn-700" strokeWidth={2} />
            <p className="text-[13.5px] leading-[1.65] text-warn-700">{set.notice}</p>
          </Card>
        )}

        {/* ---------------- Legend ---------------- */}
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <Badge tone="good">Strong Match</Badge> profile aligns well
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone="brand">Possible Match</Badge> workable with trade-offs
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone="warn">Ambitious Option</Badge> a stretch on at least one dimension
          </span>
          <span className="flex items-center gap-1">
            <Tooltip text={CATEGORY_TOOLTIP} /> What these mean
          </span>
        </div>

        {/* ---------------- Results ---------------- */}
        {set.results.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={<SearchX size={20} />}
              title="No universities matched these parameters"
              body="This normally means a very low budget combined with a single country. Try widening the destination or raising the budget using the controls above — the list rebuilds instantly."
              action={
                <Button onClick={reset} variant="secondary">
                  Reset parameters
                </Button>
              }
            />
          </div>
        ) : (
          <div
            key={`${activeProfile.preferredCountries.join()}-${activeProfile.maxAffordableAnnualUSD}`}
            className="ap-stagger mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {set.results.map((rec, i) => (
              <div key={rec.university.id} className="relative flex">
                {enteredIds.has(rec.university.id) && (
                  <span className="absolute -top-2 left-4 z-10">
                    <Badge tone="brand" className="shadow-[0_2px_8px_-2px_rgba(61,79,224,0.4)]">
                      New in your results
                    </Badge>
                  </span>
                )}
                <div className="w-full">
                  <UniversityCard rec={rec} rank={i + 1} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---------------- Methodology ---------------- */}
        <Card className="mt-10 p-6">
          <h2 className="text-[16px] font-semibold text-ink">How these scores are produced</h2>
          <p className="mt-2 max-w-3xl text-[13.5px] leading-[1.7] text-muted">
            Each university is scored on seven independent dimensions — academic alignment, financial fit,
            programme availability, geography, scholarship compatibility, entry requirements and your stated
            preferences — and combined with fixed weights. The calculation is deterministic and runs in your
            browser: the same profile always produces the same ranking, and you can inspect every component
            on any university&rsquo;s detail page.
          </p>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-[1.7] text-muted">
            What it is <strong className="font-medium text-ink">not</strong>: a prediction of whether you
            will be admitted. We do not model admission probability, and no figure in this product should be
            read as one.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ['Financial fit', '24%'],
              ['Academic alignment', '18%'],
              ['Programme match', '18%'],
              ['Geography', '13%'],
              ['Scholarship compatibility', '10%'],
              ['Preferences', '9%'],
              ['Entry requirements', '8%'],
            ].map(([label, weight]) => (
              <Badge key={label} tone="neutral">
                {label} <span className="tnum font-semibold">{weight}</span>
              </Badge>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
