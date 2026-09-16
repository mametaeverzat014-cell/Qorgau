'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Compass,
  GitCompareArrows,
  Map,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { UniversityCard } from '@/components/recs/UniversityCard';
import { NextActionCard } from '@/components/route/NextActionCard';
import { ProgressPanel } from '@/components/route/ProgressPanel';
import { Badge, Button, Card, PageSkeleton, ProgressBar, SectionTitle } from '@/components/ui';
import { upcomingDeadlines } from '@/lib/engine/roadmap';
import { formatUSD } from '@/lib/engine/utils';
import { useApp } from '@/lib/store';
import { MAJOR_LABELS, type DiagnosticLevel } from '@/lib/types';

const LEVEL_TONE: Record<DiagnosticLevel, 'good' | 'brand' | 'warn' | 'neutral'> = {
  strong: 'good',
  ready: 'good',
  moderate: 'brand',
  'needs-improvement': 'warn',
  limited: 'warn',
  'very-high': 'warn',
  competitive: 'brand',
  unknown: 'neutral',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const router = useRouter();
  const { ready, hasProfile, profile, recommendations, diagnostics, tasks, completed, compareIds } =
    useApp();

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  const deadlines = useMemo(() => upcomingDeadlines(tasks, completed, 4), [tasks, completed]);
  const openTasks = useMemo(() => tasks.filter((t) => !completed[t.id]).slice(0, 4), [tasks, completed]);

  if (!ready || !hasProfile) return <PageSkeleton />;

  const destination = profile.openToAnyCountry
    ? 'Open to anywhere'
    : profile.preferredCountries.join(', ') || 'Not set';

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
        {/* ---------------- Greeting ---------------- */}
        <div className="ap-rise flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
              {greeting()}
              {profile.name ? `, ${profile.name}` : ''}.
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.6] text-muted">
              {MAJOR_LABELS[profile.intendedMajor]} · {destination} ·{' '}
              {formatUSD(Math.max(profile.maxAffordableAnnualUSD, profile.budgetAnnualUSD))} per year
            </p>
          </div>
          <Button variant="secondary" size="sm" href="/onboarding">
            <Pencil size={14} /> Edit profile
          </Button>
        </div>

        {/* ---------------- Next action ---------------- */}
        <div className="ap-rise mt-7">
          <NextActionCard />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {/* ---------------- Readiness ---------------- */}
            <Card className="p-6">
              <SectionTitle
                hint="Derived entirely from your questionnaire answers."
                action={
                  <Button variant="ghost" size="sm" href="/diagnostics">
                    Full diagnostic <ArrowRight size={13} />
                  </Button>
                }
              >
                Application readiness
              </SectionTitle>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {diagnostics.dimensions.map((d) => (
                  <div key={d.key}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-[13.5px] text-ink-soft">{d.label}</span>
                      <Badge tone={LEVEL_TONE[d.level]}>
                        {d.level.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
                      </Badge>
                    </div>
                    <ProgressBar
                      percent={d.value}
                      tone={d.level === 'strong' || d.level === 'ready' ? 'good' : 'brand'}
                      height={5}
                    />
                  </div>
                ))}
              </div>
            </Card>

            {/* ---------------- Top recommendations ---------------- */}
            <div>
              <SectionTitle
                hint={`${recommendations.results.length} universities ranked against your profile.`}
                action={
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" href="/compare">
                      <GitCompareArrows size={13} />
                      {compareIds.length > 0 ? `Compare (${compareIds.length})` : 'Compare'}
                    </Button>
                    <Button variant="secondary" size="sm" href="/recommendations">
                      See all <ArrowRight size={13} />
                    </Button>
                  </div>
                }
              >
                Top recommendations
              </SectionTitle>
              <div className="ap-stagger grid gap-4 md:grid-cols-2">
                {recommendations.results.slice(0, 2).map((rec, i) => (
                  <UniversityCard key={rec.university.id} rec={rec} rank={i + 1} />
                ))}
              </div>
            </div>

            {/* ---------------- Roadmap snapshot ---------------- */}
            <div>
              <SectionTitle
                hint="The next open tasks on your route."
                action={
                  <Button variant="secondary" size="sm" href="/roadmap">
                    <Map size={13} /> Full roadmap
                  </Button>
                }
              >
                Roadmap snapshot
              </SectionTitle>
              <Card className="overflow-hidden">
                {openTasks.length === 0 ? (
                  <p className="px-5 py-6 text-[14px] text-muted">
                    Every task is complete. Adjust your parameters to generate a new route.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {openTasks.map((t) => (
                      <li key={t.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-ink">{t.title}</p>
                          <p className="mt-0.5 text-[12.5px] text-muted">
                            Due{' '}
                            {new Date(`${t.dueDate}T00:00:00Z`).toLocaleDateString('en-US', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </p>
                        </div>
                        {t.priority !== 'normal' && (
                          <Badge tone={t.priority === 'critical' ? 'risk' : 'warn'}>
                            {t.priority === 'critical' ? 'Critical' : 'High'}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          {/* ---------------- Sidebar ---------------- */}
          <aside className="space-y-4 lg:sticky lg:top-[76px] lg:self-start">
            <ProgressPanel />

            {/* Deadlines */}
            <Card className="p-5">
              <div className="mb-3.5 flex items-center gap-2">
                <CalendarClock size={15} className="text-muted" strokeWidth={2} />
                <h2 className="text-[14.5px] font-semibold text-ink">Upcoming deadlines</h2>
              </div>
              {deadlines.length === 0 ? (
                <p className="text-[13px] leading-[1.6] text-muted">
                  No application or scholarship deadlines outstanding.
                </p>
              ) : (
                <ul className="space-y-3">
                  {deadlines.map((t) => {
                    const due = new Date(`${t.dueDate}T00:00:00Z`);
                    const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
                    return (
                      <li key={t.id} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {t.relatedUniversityName ?? t.title}
                          </p>
                          <p className="text-[12px] text-muted">
                            {due.toLocaleDateString('en-US', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              timeZone: 'UTC',
                            })}
                          </p>
                        </div>
                        <span
                          className={`tnum shrink-0 text-[12px] font-semibold ${
                            days <= 30 ? 'text-risk-500' : days <= 60 ? 'text-warn-700' : 'text-muted'
                          }`}
                        >
                          {days >= 0 ? `${days}d` : 'passed'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* Gaps */}
            {diagnostics.gaps.length > 0 && (
              <Card className="p-5">
                <div className="mb-3.5 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-warn-500" strokeWidth={2} />
                  <h2 className="text-[14.5px] font-semibold text-ink">Potential gaps</h2>
                </div>
                <ul className="space-y-3">
                  {diagnostics.gaps.slice(0, 3).map((g) => (
                    <li key={g.key}>
                      <p className="text-[13px] font-medium leading-[1.45] text-ink">{g.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-[1.55] text-muted">{g.detail}</p>
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="sm" href="/diagnostics" className="mt-3">
                  See all gaps <ArrowRight size={13} />
                </Button>
              </Card>
            )}

            {/* What-if nudge */}
            <Card className="border-brand-100 bg-brand-50 p-5">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-brand-600" strokeWidth={2} />
                <h2 className="text-[14.5px] font-semibold text-brand-700">Try a what-if</h2>
              </div>
              <p className="mt-2 text-[13px] leading-[1.6] text-brand-700/85">
                Change your budget or destination and watch the ranking, the explanations and this whole
                roadmap change with it.
              </p>
              <Button size="sm" href="/recommendations" className="mt-3.5">
                <Compass size={13} /> Open controls
              </Button>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
