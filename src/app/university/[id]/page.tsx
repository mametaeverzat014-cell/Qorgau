'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ExternalLink,
  GitCompareArrows,
  GraduationCap,
  Languages,
  MapPin,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { AIExplanation } from '@/components/recs/AIExplanation';
import { deadlineDisplay } from '@/components/recs/UniversityCard';
import {
  Badge,
  Button,
  Card,
  DataPoint,
  EmptyState,
  PageSkeleton,
  ProgressBar,
  ScoreRing,
  Tooltip,
} from '@/components/ui';
import { getUniversity } from '@/data/universities';
import { CATEGORY_LABELS, CATEGORY_TOOLTIP } from '@/lib/engine/explain';
import { calculateOverallMatch } from '@/lib/engine/score';
import { formatUSD } from '@/lib/engine/utils';
import { useApp } from '@/lib/store';
import { MAJOR_LABELS } from '@/lib/types';

const COMPONENT_LABELS: Record<string, string> = {
  academic: 'Academic alignment',
  financial: 'Financial fit',
  major: 'Programme match',
  geography: 'Location fit',
  scholarship: 'Scholarship compatibility',
  tests: 'Entry requirements',
  preference: 'Your preferences',
};

const CATEGORY_TONE = { strong: 'good', possible: 'brand', ambitious: 'warn' } as const;

export default function UniversityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, hasProfile, profile, compareIds, toggleCompare } = useApp();

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  const uni = getUniversity(params.id);
  const rec = useMemo(() => (uni ? calculateOverallMatch(profile, uni) : null), [profile, uni]);

  if (!ready || !hasProfile) return <PageSkeleton />;

  if (!uni || !rec) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[720px] px-5 py-16">
          <EmptyState
            title="University not found"
            body="That link does not match any university in our curated dataset. It may have been renamed or removed."
            action={<Button href="/recommendations">Back to recommendations</Button>}
          />
        </div>
      </AppShell>
    );
  }

  const fin = rec.fits.financial;
  const inCompare = compareIds.includes(uni.id);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-8">
        <Button variant="ghost" size="sm" href="/recommendations" className="mb-6">
          <ArrowLeft size={14} /> All recommendations
        </Button>

        {/* ---------------- Header ---------------- */}
        <div className="ap-rise flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge tone={CATEGORY_TONE[rec.category]}>{CATEGORY_LABELS[rec.category]}</Badge>
              <Tooltip text={CATEGORY_TOOLTIP} />
              <Badge tone="neutral">{uni.admissionSelectivity.replace('-', ' ')}</Badge>
            </div>
            <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[38px]">
              {uni.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-muted">
              <span className="flex items-center gap-1.5">
                <MapPin size={13.5} strokeWidth={2} /> {uni.city}, {uni.country}
              </span>
              <span className="flex items-center gap-1.5">
                <Languages size={13.5} strokeWidth={2} /> {uni.languagesOfInstruction.join(' / ')}
              </span>
              <span className="flex items-center gap-1.5">
                <GraduationCap size={13.5} strokeWidth={2} /> {uni.size} university
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className="flex flex-col items-center">
              <ScoreRing score={rec.score} size={78} />
              <span className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-faint">
                Match score
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                variant={inCompare ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => toggleCompare(uni.id)}
                disabled={!inCompare && compareIds.length >= 4}
              >
                {inCompare ? <Check size={14} strokeWidth={2.6} /> : <GitCompareArrows size={14} />}
                {inCompare ? 'In comparison' : 'Add to compare'}
              </Button>
              <Button variant="ghost" size="sm" href={uni.officialUrl}>
                Official site <ExternalLink size={13} />
              </Button>
            </div>
          </div>
        </div>

        {/* ---------------- Why this university ---------------- */}
        <Card className="ap-rise mt-8 p-6">
          <h2 className="text-[17px] font-semibold text-ink">Why this university, for you</h2>
          <p className="mt-3 text-[15px] leading-[1.7] text-ink-soft">{rec.summary}</p>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-faint">
                Why it matches
              </h3>
              <ul className="mt-3 space-y-2.5">
                {rec.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-ink-soft">
                    <Check size={14} strokeWidth={2.6} className="mt-[3px] shrink-0 text-good-500" />
                    <span>{r}</span>
                  </li>
                ))}
                {rec.reasons.length === 0 && (
                  <li className="text-[13.5px] text-muted">
                    Nothing in your profile aligns strongly with this university.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-faint">
                Watch out
              </h3>
              <ul className="mt-3 space-y-2.5">
                {rec.concerns.map((c, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-ink-soft">
                    <AlertTriangle
                      size={14}
                      strokeWidth={2.2}
                      className="mt-[3px] shrink-0 text-warn-500"
                    />
                    <span>{c}</span>
                  </li>
                ))}
                {rec.concerns.length === 0 && (
                  <li className="text-[13.5px] text-muted">
                    No significant concerns were raised against your profile.
                  </li>
                )}
              </ul>
            </div>
          </div>

          <AIExplanation rec={rec} profile={profile} />
        </Card>

        {/* ---------------- Score breakdown ---------------- */}
        <Card className="ap-rise mt-4 p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-semibold text-ink">How the score breaks down</h2>
            <Tooltip text="Each dimension is scored 0-100 independently, then combined using fixed weights. Nothing is hidden." />
          </div>
          <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {(
              Object.entries(rec.components) as [keyof typeof rec.components, number][]
            ).map(([key, value]) => (
              <div key={key}>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[13.5px] text-ink-soft">{COMPONENT_LABELS[key]}</span>
                  <span className="tnum text-[13px] font-semibold text-ink">{value}</span>
                </div>
                <ProgressBar
                  percent={value}
                  tone={value >= 75 ? 'good' : value >= 50 ? 'brand' : 'ink'}
                  height={5}
                />
              </div>
            ))}
          </div>
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* ---------------- Financial ---------------- */}
          <Card className="ap-rise p-6">
            <div className="flex items-center gap-2">
              <Wallet size={16} className="text-muted" strokeWidth={2} />
              <h2 className="text-[17px] font-semibold text-ink">Financial picture</h2>
            </div>

            <div className="mt-4">
              <DataPoint
                label="Estimated tuition / year"
                value={formatUSD(uni.estimatedTuition.value)}
                confidence={uni.estimatedTuition.confidence}
                note={uni.estimatedTuition.note}
              />
              <DataPoint
                label="Estimated living cost / year"
                value={formatUSD(uni.estimatedLivingCost.value)}
                confidence={uni.estimatedLivingCost.confidence}
                note={uni.estimatedLivingCost.note}
              />
              <DataPoint label="Total sticker cost / year" value={formatUSD(fin.totalAnnualCost)} />
              <DataPoint
                label="Best realistic cost to you / year"
                value={formatUSD(fin.bestCaseNetCost)}
                note="After the most favourable realistic aid outcome we can justify from published policy."
              />
              <DataPoint
                label="Your stated ceiling / year"
                value={formatUSD(Math.max(profile.maxAffordableAnnualUSD, profile.budgetAnnualUSD))}
              />
              {fin.fundingGap !== null && fin.fundingGap > 0 && (
                <DataPoint label="Remaining annual gap" value={formatUSD(fin.fundingGap)} />
              )}
            </div>

            {uni.estimatedTuition.note && (
              <p className="mt-3 text-[12.5px] leading-[1.6] text-muted">{uni.estimatedTuition.note}</p>
            )}
          </Card>

          {/* ---------------- Scholarships ---------------- */}
          <Card className="ap-rise p-6">
            <div className="flex items-center gap-2">
              <ScrollText size={16} className="text-muted" strokeWidth={2} />
              <h2 className="text-[17px] font-semibold text-ink">Scholarships and aid</h2>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={uni.fullRidePossible ? 'good' : 'neutral'}>
                {uni.fullRidePossible ? 'Full cost possible' : 'No full-cost award published'}
              </Badge>
              <Badge tone={uni.fullTuitionPossible ? 'good' : 'neutral'}>
                {uni.fullTuitionPossible ? 'Full tuition possible' : 'No full-tuition award published'}
              </Badge>
              <Badge tone={uni.needBasedAidForInternationals ? 'good' : 'neutral'}>
                {uni.needBasedAidForInternationals ? 'Need-based aid for internationals' : 'Merit-based only'}
              </Badge>
              <Badge tone="neutral">
                Availability: {uni.scholarshipAvailability.replace(/-/g, ' ')}
              </Badge>
            </div>

            <p className="mt-4 text-[13.5px] leading-[1.7] text-ink-soft">{uni.aidNote}</p>

            <Button variant="secondary" size="sm" href={uni.scholarshipUrl} className="mt-4">
              Check scholarships on the official site <ExternalLink size={13} />
            </Button>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* ---------------- Requirements ---------------- */}
          <Card className="ap-rise p-6">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-muted" strokeWidth={2} />
              <h2 className="text-[17px] font-semibold text-ink">Entry requirements</h2>
              <Tooltip text="Requirements are as published by the institution. Confirm them at the source link before you rely on them." />
            </div>
            <div className="mt-4">
              <DataPoint
                label="Minimum English"
                value={
                  uni.minimumIELTS !== null
                    ? `IELTS ${uni.minimumIELTS}${uni.minimumTOEFL ? ` / TOEFL ${uni.minimumTOEFL}` : ''}`
                    : uni.recommendedIELTS !== null
                      ? `IELTS ~${uni.recommendedIELTS} recommended`
                      : 'Not published'
                }
                confidence={uni.minimumIELTS !== null ? 'published' : 'unknown'}
              />
              <DataPoint
                label="SAT / ACT policy"
                value={
                  uni.satPolicy === 'not-used'
                    ? 'Not used in admissions'
                    : `${uni.satPolicy.charAt(0).toUpperCase()}${uni.satPolicy.slice(1)}${
                        uni.recommendedSAT ? ` · typical ~${uni.recommendedSAT}` : ''
                      }`
                }
                confidence={uni.satPolicy === 'unknown' ? 'unknown' : 'published'}
              />
              <DataPoint
                label="Typical academic profile"
                value={`~${uni.gpaExpectation}% school average`}
                confidence="estimate"
                note="Our normalised estimate of a competitive intake, not an official cut-off."
              />
              <DataPoint label="Application platform" value={uni.applicationPlatform} confidence="published" />
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-muted">{uni.selectivityNote}</p>
          </Card>

          {/* ---------------- Deadlines ---------------- */}
          <Card className="ap-rise p-6">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-muted" strokeWidth={2} />
              <h2 className="text-[17px] font-semibold text-ink">Important deadlines</h2>
            </div>
            <div className="mt-4">
              <DataPoint label="Application deadline" value={deadlineDisplay(uni.applicationDeadline)} />
              <DataPoint label="Scholarship deadline" value={deadlineDisplay(uni.scholarshipDeadline)} />
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-muted">
              Deadlines shown are the typical international undergraduate dates for this cycle. They move
              year to year — always confirm on the official admissions page before planning around them.
            </p>

            <h3 className="mt-6 text-[12px] font-semibold uppercase tracking-[0.07em] text-faint">
              Programmes for {MAJOR_LABELS[profile.intendedMajor]}
            </h3>
            <ul className="mt-2.5 space-y-1.5">
              {uni.programs.map((p) => (
                <li key={p} className="text-[13.5px] leading-[1.55] text-ink-soft">
                  · {p}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* ---------------- Sources ---------------- */}
        <Card className="ap-rise mt-4 p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold text-ink">Official source</h2>
          <p className="mt-2 max-w-3xl text-[13.5px] leading-[1.7] text-muted">
            Everything on this page must be confirmed with {uni.shortName} before you act on it.
            Figures marked <Badge tone="neutral">Estimate</Badge> are our indicative compilation for
            the current cycle and are not quoted from the institution. Figures marked{' '}
            <Badge tone="good">Published</Badge> reflect stated institutional policy.
          </p>

          <a
            href={uni.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group mt-5 flex items-center justify-between gap-3 rounded-[11px] border border-line bg-paper p-4 transition-all duration-200 hover:border-line-strong hover:bg-surface-soft"
          >
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-ink">
                Open the official {uni.shortName} website
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-faint">
                {uni.officialUrl.replace(/^https:\/\//, '')}
              </span>
            </span>
            <ExternalLink
              size={16}
              className="shrink-0 text-faint transition-colors group-hover:text-ink"
            />
          </a>

          <div className="mt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.07em] text-faint">
              Check these three things there
            </h3>
            <ul className="mt-2.5 space-y-1.5 text-[13px] leading-[1.6] text-ink-soft">
              <li>· Entry requirements for international applicants, and this year&rsquo;s deadlines</li>
              <li>· Current tuition and the estimated cost of living</li>
              <li>· Scholarships open to international undergraduates, and their separate deadlines</li>
            </ul>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-faint">
              We link the institution&rsquo;s main site rather than a deep page on purpose: universities
              reorganise their admissions pages frequently, and a link that 404s is worse than one that
              makes you navigate one level.
            </p>
          </div>
        </Card>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" href="/recommendations">
            <ArrowLeft size={14} /> Back to recommendations
          </Button>
          <Button href="/compare">
            <GitCompareArrows size={15} />
            {compareIds.length > 0 ? `Compare (${compareIds.length})` : 'Compare'}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
