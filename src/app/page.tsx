'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ClipboardList,
  Clock3,
  Compass,
  GitCompareArrows,
  Map,
  Play,
  Target,
  TrendingUp,
} from 'lucide-react';
import { DEMO_PROFILES, getDemoProfile } from '@/lib/demo';
import { UNIVERSITIES } from '@/data/universities';
import { useApp } from '@/lib/store';
import { Logo } from '@/components/AppShell';
import { Badge, Button, Card } from '@/components/ui';

const JOURNEY = [
  { icon: ClipboardList, title: 'Questionnaire', body: 'Five short steps. About two minutes.' },
  { icon: Target, title: 'Diagnostics', body: 'Where your profile is strong, and where it is not.' },
  { icon: Compass, title: 'Recommendations', body: 'Matched universities, each one explained.' },
  { icon: GitCompareArrows, title: 'Comparison', body: 'Side by side on the things that decide it.' },
  { icon: Map, title: 'Roadmap', body: 'Your months, your deadlines, your tasks.' },
  { icon: TrendingUp, title: 'Progress', body: 'One next action, and a route that fills in.' },
];

const OUTCOME_PREVIEW = [
  { label: 'Your profile', value: 'Six readiness dimensions, read from your answers' },
  { label: 'Matched universities', value: 'Ranked, each with the reasoning behind it' },
  { label: 'Affordability verdict', value: 'Checked against what your family can pay' },
  { label: 'Side-by-side comparison', value: 'Where each option wins and loses' },
  { label: 'Your roadmap', value: 'Dated tasks against real deadlines' },
  { label: 'Your next action', value: 'One thing to do, and why it comes first' },
];

export default function WelcomePage() {
  const router = useRouter();
  const { setProfile, hasProfile } = useApp();
  const [demoOpen, setDemoOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const countries = new Set(UNIVERSITIES.map((u) => u.country)).size;

  function loadDemo(id: string) {
    setLoading(id);
    const profile = getDemoProfile(id);
    if (!profile) {
      setLoading(null);
      return;
    }
    setProfile(profile);
    router.push('/diagnostics');
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-[60px] w-full max-w-[1180px] items-center justify-between px-5">
        <Logo />
        {hasProfile && (
          <Button variant="ghost" size="sm" href="/dashboard">
            Back to my route <ArrowRight size={14} />
          </Button>
        )}
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="mx-auto grid w-full max-w-[1180px] gap-14 px-5 pb-16 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
        <div className="ap-rise">
          <Badge tone="brand" className="mb-6">
            <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
            Personalized admissions navigator
          </Badge>

          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[58px]">
            Build your university
            <br className="hidden sm:block" /> application route.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-[1.65] text-ink-soft sm:text-[19px]">
            Tell us where you are now. We&rsquo;ll show where you can go and what to do next —
            with the reasoning behind every recommendation.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" href="/onboarding">
              Build My Route <ArrowRight size={17} />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setDemoOpen((o) => !o)}>
              <Play size={15} /> Try Demo Profile
            </Button>
          </div>

          <p className="mt-5 flex items-center gap-1.5 text-[13.5px] text-muted">
            <Clock3 size={14} strokeWidth={2} />
            About 2 minutes · No account, no email · Your answers stay in your browser
          </p>
        </div>

        {/* ---------------- Outcome preview ---------------- */}
        <div className="ap-rise hidden lg:block" style={{ animationDelay: '120ms' }}>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line bg-surface-soft px-4 py-2.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                What you end up with
              </span>
              <span className="tnum text-[11.5px] font-medium text-muted">6 outputs</span>
            </div>
            <ol className="divide-y divide-line">
              {OUTCOME_PREVIEW.map((row, i) => (
                <li key={row.label} className="flex items-center gap-3 px-4 py-3">
                  <span className="tnum w-5 shrink-0 text-[11.5px] font-semibold text-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{row.label}</span>
                    <span className="mt-0.5 block text-[12px] leading-[1.45] text-muted">{row.value}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-faint" />
                </li>
              ))}
            </ol>
            <div className="border-t border-line bg-paper px-4 py-3">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-ink">Application journey</span>
                <span className="tnum text-[12px] font-semibold text-ink">32%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
                <div className="h-full w-[32%] rounded-full bg-ink" />
              </div>
              <p className="mt-2 text-[11.5px] leading-[1.5] text-faint">
                Illustrative. Your own figures come from your answers and the tasks you complete.
              </p>
            </div>
          </Card>
        </div>
      </section>

      {/* ---------------- Demo picker ---------------- */}
      <section className="mx-auto w-full max-w-[1180px] px-5">
        {demoOpen && (
          <div className="ap-rise pb-14">
            <Card className="overflow-hidden">
              <div className="border-b border-line bg-surface-soft px-5 py-3.5">
                <h2 className="text-[14.5px] font-semibold text-ink">Load a demo student</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Three bundled profiles, each exercising a different part of the engine. Nothing to type.
                </p>
              </div>
              <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {DEMO_PROFILES.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => loadDemo(d.id)}
                    disabled={loading !== null}
                    className="group flex flex-col items-start gap-2 p-5 text-left transition-colors duration-200 hover:bg-surface-soft disabled:opacity-50"
                  >
                    <span className="text-[14.5px] font-semibold text-ink">{d.label}</span>
                    <span className="text-[12.5px] font-medium leading-[1.55] text-brand-600">
                      {d.tagline}
                    </span>
                    <span className="text-[13px] leading-[1.6] text-muted">{d.blurb}</span>
                    <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-ink">
                      {loading === d.id ? 'Loading…' : 'Load this student'}
                      <ArrowRight
                        size={13}
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* ---------------- The problem ---------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid w-full max-w-[1180px] gap-10 px-5 py-14 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-ink sm:text-[30px]">
              A university list is not a plan.
            </h2>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-ink-soft">
              Most tools hand a student twenty university names and stop. That leaves every hard
              question untouched: can I actually afford this, is my IELTS enough, which deadline comes
              first, and what am I supposed to do tomorrow morning?
            </p>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-ink-soft">
              AdmitPath answers those instead. Every recommendation carries its reasoning, every cost is
              checked against what your family can actually pay, and the output is a dated route —
              not a directory.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['I don&rsquo;t know which universities fit me.', 'Diagnostics + explained matching'],
              ['I can&rsquo;t tell what I can afford.', 'Budget-aware financial verdicts'],
              ['I don&rsquo;t know if my scores are enough.', 'Requirement gaps, named explicitly'],
              ['I keep losing track of deadlines.', 'A dated roadmap built from your shortlist'],
            ].map(([problem, answer]) => (
              <Card key={answer} className="p-4">
                <p
                  className="text-[14px] font-medium leading-[1.5] text-ink"
                  dangerouslySetInnerHTML={{ __html: `&ldquo;${problem}&rdquo;` }}
                />
                <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-good-700">
                  <Check size={13} strokeWidth={2.5} className="mt-[3px] shrink-0" />
                  {answer}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- Journey ---------------- */}
      <section className="mx-auto w-full max-w-[1180px] px-5 py-16">
        <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-ink sm:text-[30px]">
          What happens after you answer.
        </h2>
        <p className="mt-3 max-w-xl text-[15.5px] leading-[1.7] text-muted">
          One profile in. Six things out — in this order, because that is the order a student
          actually needs them.
        </p>

        <ol className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JOURNEY.map(({ icon: Icon, title, body }, i) => (
            <Card key={title} hover as="li" className="p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
                  <Icon size={16} strokeWidth={2} />
                </span>
                <span className="tnum text-[12px] font-semibold text-faint">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-[15.5px] font-semibold text-ink">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-[1.6] text-muted">{body}</p>
            </Card>
          ))}
        </ol>
      </section>

      {/* ---------------- Honest footing ---------------- */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-14">
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <p className="tnum text-[32px] font-semibold tracking-[-0.03em] text-ink">
                {UNIVERSITIES.length}
              </p>
              <p className="mt-1 text-[14px] font-medium text-ink">curated universities</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">
                Across {countries} countries. Hand-checked rather than scraped — each record carries
                official source links.
              </p>
            </div>
            <div>
              <p className="tnum text-[32px] font-semibold tracking-[-0.03em] text-ink">7</p>
              <p className="mt-1 text-[14px] font-medium text-ink">scoring dimensions</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">
                Academic, financial, major, geography, scholarship, requirements and preference — all
                visible, none hidden behind a black box.
              </p>
            </div>
            <div>
              <p className="tnum text-[32px] font-semibold tracking-[-0.03em] text-ink">0</p>
              <p className="mt-1 text-[14px] font-medium text-ink">admission probabilities</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-muted">
                We will not invent your chances of getting in. A match score describes fit with your
                stated profile, and we say so everywhere it appears.
              </p>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start gap-4 rounded-[14px] border border-line bg-paper p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[17px] font-semibold text-ink">Ready to see your route?</h3>
              <p className="mt-1 text-[14px] text-muted">
                Five steps, about two minutes, and you can change any answer afterwards.
              </p>
            </div>
            <Button size="lg" href="/onboarding">
              Build My Route <ArrowRight size={17} />
            </Button>
          </div>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-[1180px] px-5 py-8">
        <p className="text-[12.5px] leading-[1.6] text-faint">
          AdmitPath AI · Built for LOCUSCASE2 &laquo;Маршрут поступления&raquo;. Decision-support only —
          confirm every figure and deadline with the university before you act on it.
        </p>
      </footer>
    </div>
  );
}
