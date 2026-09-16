'use client';

import { ArrowRight, Check, PartyPopper, Target } from 'lucide-react';
import { Badge, Button, Card } from '@/components/ui';
import { useApp } from '@/lib/store';

const PRIORITY_TONE = { critical: 'risk', high: 'warn', normal: 'neutral' } as const;

/**
 * The single most important thing to do right now.
 *
 * Completing it promotes the next task immediately, which is what makes the
 * product behave like a navigator rather than a static report.
 */
export function NextActionCard({ compact = false }: { compact?: boolean }) {
  const { nextAction, toggleTask, progress } = useApp();

  if (!nextAction) {
    return (
      <Card className="border-good-500/25 bg-good-50 p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-good-500 text-white">
            <PartyPopper size={15} strokeWidth={2.2} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold text-good-700">
              Every task on your route is complete
            </h2>
            <p className="mt-1.5 text-[14px] leading-[1.6] text-good-700/85">
              You have finished all {progress.totalTasks} tasks. Change your budget or destination on the
              recommendations screen to generate a new route, or revisit a completed task to reopen it.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const { task, why, ctaLabel, ctaHref } = nextAction;

  return (
    <Card className="overflow-hidden border-ink/12">
      <div className="bg-ink px-6 py-5 text-white">
        <div className="flex items-center gap-2">
          <Target size={14} strokeWidth={2.2} className="text-white/70" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.09em] text-white/70">
            Your next step
          </span>
        </div>
        <h2
          className={`mt-2.5 font-semibold leading-[1.25] tracking-[-0.02em] ${
            compact ? 'text-[20px]' : 'text-[24px]'
          }`}
        >
          {task.title}
        </h2>
        <p className="mt-2.5 max-w-2xl text-[14px] leading-[1.6] text-white/75">
          <span className="font-medium text-white/90">Why: </span>
          {why}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={PRIORITY_TONE[task.priority]}>
            {task.priority === 'critical' ? 'Critical' : task.priority === 'high' ? 'High priority' : 'Normal'}
          </Badge>
          <Badge tone="neutral">Due {new Date(`${task.dueDate}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</Badge>
          <Badge tone="neutral">{task.category}</Badge>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" onClick={() => toggleTask(task.id)}>
            <Check size={14} strokeWidth={2.6} /> Mark complete
          </Button>
          <Button size="sm" href={ctaHref}>
            {ctaLabel} <ArrowRight size={13} />
          </Button>
        </div>
      </div>
    </Card>
  );
}
