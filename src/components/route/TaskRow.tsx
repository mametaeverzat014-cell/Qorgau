'use client';

import Link from 'next/link';
import { Check, ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { useApp } from '@/lib/store';
import type { RoadmapTask } from '@/lib/types';

const PRIORITY_TONE = { critical: 'risk', high: 'warn', normal: 'neutral' } as const;

const CATEGORY_LABEL: Record<RoadmapTask['category'], string> = {
  shortlist: 'Shortlist',
  tests: 'Tests',
  documents: 'Documents',
  applications: 'Applications',
  scholarships: 'Scholarships',
};

export function TaskRow({ task, showRationale = true }: { task: RoadmapTask; showRationale?: boolean }) {
  const { completed, toggleTask } = useApp();
  const done = Boolean(completed[task.id]);
  const due = new Date(`${task.dueDate}T00:00:00Z`);
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);

  return (
    <li
      className={`flex gap-3.5 px-5 py-4 transition-colors duration-200 ${
        done ? 'bg-surface-soft/60' : 'hover:bg-surface-soft/50'
      }`}
    >
      <button
        onClick={() => toggleTask(task.id)}
        aria-pressed={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-all duration-200 ${
          done
            ? 'border-good-500 bg-good-500 text-white'
            : 'border-line-strong bg-surface hover:border-ink'
        }`}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={`text-[14.5px] font-medium leading-[1.4] ${
              done ? 'text-muted line-through' : 'text-ink'
            }`}
          >
            {task.title}
          </h3>
          {!done && task.priority !== 'normal' && (
            <Badge tone={PRIORITY_TONE[task.priority]}>
              {task.priority === 'critical' ? 'Critical' : 'High'}
            </Badge>
          )}
        </div>

        <p className={`mt-1 text-[13px] leading-[1.6] ${done ? 'text-faint' : 'text-muted'}`}>
          {task.description}
        </p>

        {showRationale && !done && (
          <p className="mt-2 border-l-2 border-line pl-2.5 text-[12.5px] leading-[1.55] text-faint">
            Generated because: {task.rationale}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted">
          <span className="flex items-center gap-1">
            <Clock size={11.5} strokeWidth={2} />
            {due.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
            {!done && days >= 0 && days <= 30 && (
              <span className="font-semibold text-warn-700"> · {days}d left</span>
            )}
            {!done && days < 0 && <span className="font-semibold text-risk-500"> · overdue</span>}
          </span>
          <span className="text-faint">{CATEGORY_LABEL[task.category]}</span>
          {task.relatedUniversityId && (
            <Link
              href={`/university/${task.relatedUniversityId}`}
              className="inline-flex items-center gap-0.5 font-medium text-brand-600 transition-colors hover:text-brand-700"
            >
              {task.relatedUniversityName}
              <ChevronRight size={12} />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
