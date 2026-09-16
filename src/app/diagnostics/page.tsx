'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AlertTriangle, ArrowRight, Lightbulb, Pencil } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Button, Card, PageSkeleton, ProgressBar, Reveal } from '@/components/ui';
import { useApp } from '@/lib/store';
import type { DiagnosticLevel } from '@/lib/types';

const LEVEL_LABEL: Record<DiagnosticLevel, string> = {
  strong: 'Strong',
  ready: 'Ready',
  moderate: 'Moderate',
  'needs-improvement': 'Needs improvement',
  limited: 'Limited',
  'very-high': 'Very high',
  competitive: 'Competitive',
  unknown: 'Unknown',
};

const LEVEL_TONE: Record<DiagnosticLevel, 'good' | 'brand' | 'warn' | 'neutral' | 'risk'> = {
  strong: 'good',
  ready: 'good',
  moderate: 'brand',
  'needs-improvement': 'warn',
  limited: 'warn',
  'very-high': 'warn',
  competitive: 'brand',
  unknown: 'neutral',
};

const BAR_TONE: Record<DiagnosticLevel, 'good' | 'brand' | 'ink'> = {
  strong: 'good',
  ready: 'good',
  moderate: 'brand',
  'needs-improvement': 'ink',
  limited: 'ink',
  'very-high': 'ink',
  competitive: 'brand',
  unknown: 'ink',
};

export default function DiagnosticsPage() {
  const router = useRouter();
  const { ready, hasProfile, diagnostics, profile, recommendations } = useApp();

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  if (!ready || !hasProfile) return <PageSkeleton />;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
        <div className="ap-rise max-w-2xl">
          <Badge tone="brand" className="mb-4">
            Step 2 of 3 · Before the university list
          </Badge>
          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[40px]">
            {profile.name ? `${profile.name}, here is` : 'Here is'} your application profile
          </h1>
          <p className="mt-4 text-[16px] leading-[1.65] text-ink-soft">
            Before we show you a single university, this is what your answers say about where you stand.
            Every line below comes from something you entered — nothing here is assumed.
          </p>
        </div>

        {/* ---------------- Dimensions ---------------- */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {diagnostics.dimensions.map((d, i) => (
            <Reveal key={d.key} delay={i * 50}>
              <Card className="h-full p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[14.5px] font-medium text-muted">{d.label}</h2>
                  <Badge tone={LEVEL_TONE[d.level]}>{LEVEL_LABEL[d.level]}</Badge>
                </div>
                <ProgressBar percent={d.value} tone={BAR_TONE[d.level]} height={6} className="mt-4" />
                <p className="mt-3.5 text-[13.5px] leading-[1.6] text-ink-soft">{d.detail}</p>
              </Card>
            </Reveal>
          ))}
        </div>

        {/* ---------------- Insights ---------------- */}
        {diagnostics.insights.length > 0 && (
          <Reveal>
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-2">
                <Lightbulb size={17} className="text-brand-600" strokeWidth={2} />
                <h2 className="text-[19px] font-semibold text-ink">What this means for you</h2>
              </div>
              <div className="grid gap-3">
                {diagnostics.insights.map((insight, i) => (
                  <Card key={i} className="flex gap-4 p-5">
                    <span className="tnum mt-[2px] text-[13px] font-semibold text-faint">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className="text-[14.5px] leading-[1.7] text-ink-soft">{insight}</p>
                  </Card>
                ))}
              </div>
            </section>
          </Reveal>
        )}

        {/* ---------------- Gaps ---------------- */}
        {diagnostics.gaps.length > 0 && (
          <Reveal>
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle size={17} className="text-warn-500" strokeWidth={2} />
                <h2 className="text-[19px] font-semibold text-ink">Gaps we will plan around</h2>
              </div>
              <p className="mb-4 max-w-2xl text-[14px] leading-[1.65] text-muted">
                Each of these becomes a dated task in your roadmap. Nothing here disqualifies you — it
                just changes the order you should do things in.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {diagnostics.gaps.map((gap) => (
                  <Card key={gap.key} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[14.5px] font-semibold leading-[1.4] text-ink">{gap.title}</h3>
                      <Badge tone={gap.severity === 'high' ? 'warn' : gap.severity === 'medium' ? 'brand' : 'neutral'}>
                        {gap.severity === 'high' ? 'Act now' : gap.severity === 'medium' ? 'Plan for it' : 'Consider'}
                      </Badge>
                    </div>
                    <p className="mt-2.5 text-[13.5px] leading-[1.65] text-muted">{gap.detail}</p>
                  </Card>
                ))}
              </div>
            </section>
          </Reveal>
        )}

        {/* ---------------- CTA ---------------- */}
        <Reveal>
          <Card className="mt-12 flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[18px] font-semibold text-ink">
                Now let&rsquo;s see where you fit
              </h2>
              <p className="mt-1.5 max-w-xl text-[14px] leading-[1.6] text-muted">
                We scored all {recommendations.all.length} universities in our dataset against this profile.
                Each recommendation comes with the reasoning behind it, and you can change your budget or
                country on that screen and watch the list respond.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:shrink-0">
              <Button variant="secondary" href="/onboarding">
                <Pencil size={14} /> Edit answers
              </Button>
              <Button size="lg" href="/recommendations">
                See recommendations <ArrowRight size={16} />
              </Button>
            </div>
          </Card>
        </Reveal>
      </div>
    </AppShell>
  );
}
