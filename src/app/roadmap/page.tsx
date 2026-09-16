'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Filter, ListChecks } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { NextActionCard } from '@/components/route/NextActionCard';
import { ProgressPanel } from '@/components/route/ProgressPanel';
import { TaskRow } from '@/components/route/TaskRow';
import { Badge, Button, Card, EmptyState, PageSkeleton } from '@/components/ui';
import { groupByMonth } from '@/lib/engine/roadmap';
import { useApp } from '@/lib/store';
import type { TaskCategory } from '@/lib/types';

const FILTERS: { key: TaskCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'shortlist', label: 'Shortlist' },
  { key: 'tests', label: 'Tests' },
  { key: 'documents', label: 'Documents' },
  { key: 'scholarships', label: 'Scholarships' },
  { key: 'applications', label: 'Applications' },
];

export default function RoadmapPage() {
  const router = useRouter();
  const { ready, hasProfile, tasks, completed, progress } = useApp();
  const [filter, setFilter] = useState<TaskCategory | 'all'>('all');
  const [hideDone, setHideDone] = useState(false);

  useEffect(() => {
    if (ready && !hasProfile) router.replace('/onboarding');
  }, [ready, hasProfile, router]);

  const visible = useMemo(() => {
    let list = tasks;
    if (filter !== 'all') list = list.filter((t) => t.category === filter);
    if (hideDone) list = list.filter((t) => !completed[t.id]);
    return list;
  }, [tasks, filter, hideDone, completed]);

  const months = useMemo(() => groupByMonth(visible), [visible]);

  if (!ready || !hasProfile) return <PageSkeleton />;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
        <div className="ap-rise max-w-2xl">
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-ink sm:text-[36px]">
            Your personal roadmap
          </h1>
          <p className="mt-3 text-[15.5px] leading-[1.65] text-ink-soft">
            {tasks.length} tasks, dated against the real deadlines of your recommended universities and
            the gaps we found in your profile. Every task states why it exists — none of this is a
            generic checklist.
          </p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <NextActionCard />

            {/* ---------------- Filters ---------------- */}
            <Card className="flex flex-wrap items-center gap-2 px-5 py-3.5">
              <Filter size={14} className="text-faint" strokeWidth={2} />
              {FILTERS.map((f) => {
                const count =
                  f.key === 'all' ? tasks.length : tasks.filter((t) => t.category === f.key).length;
                if (count === 0) return null;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-200 ${
                      filter === f.key
                        ? 'border-ink bg-ink text-white'
                        : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                    }`}
                  >
                    {f.label} <span className="tnum opacity-60">{count}</span>
                  </button>
                );
              })}
              <button
                onClick={() => setHideDone((h) => !h)}
                className={`ml-auto rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all duration-200 ${
                  hideDone
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                }`}
              >
                Hide completed
              </button>
            </Card>

            {/* ---------------- Timeline ---------------- */}
            {months.length === 0 ? (
              <EmptyState
                icon={<ListChecks size={20} />}
                title={hideDone ? 'Nothing left in this view' : 'No tasks in this category'}
                body={
                  hideDone
                    ? 'You have completed every task matching these filters. Switch the filter or show completed tasks to review them.'
                    : 'Change the filter to see the rest of your roadmap.'
                }
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setFilter('all');
                      setHideDone(false);
                    }}
                  >
                    Show everything
                  </Button>
                }
              />
            ) : (
              months.map((month) => {
                const done = month.tasks.filter((t) => completed[t.id]).length;
                return (
                  <section key={month.monthKey}>
                    <div className="mb-2.5 mt-6 flex items-center gap-3 first:mt-0">
                      <CalendarDays size={15} className="text-muted" strokeWidth={2} />
                      <h2 className="text-[16px] font-semibold text-ink">{month.label}</h2>
                      <Badge tone={done === month.tasks.length ? 'good' : 'neutral'}>
                        {done}/{month.tasks.length} done
                      </Badge>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                    <Card className="overflow-hidden">
                      <ul className="divide-y divide-line">
                        {month.tasks.map((task) => (
                          <TaskRow key={task.id} task={task} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                );
              })
            )}
          </div>

          {/* ---------------- Sidebar ---------------- */}
          <aside className="space-y-4 lg:sticky lg:top-[76px] lg:self-start">
            <ProgressPanel />
            <Card className="p-5">
              <h2 className="text-[14.5px] font-semibold text-ink">How this roadmap was built</h2>
              <ul className="mt-3 space-y-2.5 text-[13px] leading-[1.6] text-muted">
                <li>
                  · Test tasks appear only where your scores fall short of what your shortlist requires.
                </li>
                <li>
                  · Financial-documentation tasks appear only because you said you need scholarship
                  support.
                </li>
                <li>
                  · Application and scholarship tasks carry the real published deadline of each
                  recommended university.
                </li>
                <li>
                  · Priority rises automatically as a deadline approaches, which reorders your next step.
                </li>
              </ul>
              <p className="mt-4 text-[12.5px] leading-[1.6] text-faint">
                Change your budget or destination on the recommendations screen and this roadmap
                regenerates against the new shortlist.
              </p>
            </Card>
            <Card className="p-5">
              <h2 className="text-[14.5px] font-semibold text-ink">Completed so far</h2>
              <p className="tnum mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
                {progress.completedTasks}
                <span className="text-[16px] font-normal text-muted"> / {progress.totalTasks}</span>
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.6] text-muted">
                Ticking a task here immediately updates your progress bars and promotes the next step.
              </p>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
