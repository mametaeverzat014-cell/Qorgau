'use client';

import { Card, ProgressBar } from '@/components/ui';
import { useApp } from '@/lib/store';

/**
 * Progress is derived entirely from real state — the questionnaire being
 * complete, and which roadmap tasks have actually been ticked. Nothing here is
 * decorative.
 */
export function ProgressPanel({ title = 'Application journey' }: { title?: string }) {
  const { progress } = useApp();

  return (
    <Card className="p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
        <div className="text-right">
          <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink">
            {progress.overallPercent}%
          </span>
          <p className="mt-1 text-[12px] text-muted">route completed</p>
        </div>
      </div>

      <ProgressBar percent={progress.overallPercent} tone="ink" height={8} className="mt-4" />

      <div className="mt-6 space-y-3.5">
        {progress.tracks.map((track) => (
          <div key={track.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] text-ink-soft">{track.label}</span>
              <span className="tnum text-[12.5px] text-muted">
                {track.completed}/{track.total}
                <span className="ml-2 font-semibold text-ink">{track.percent}%</span>
              </span>
            </div>
            <ProgressBar
              percent={track.percent}
              tone={track.percent === 100 ? 'good' : 'brand'}
              height={5}
            />
          </div>
        ))}
      </div>

      <p className="mt-5 text-[12.5px] leading-[1.6] text-muted">
        {progress.completedTasks} of {progress.totalTasks} tasks complete. This only moves when you
        actually complete something — we do not show progress you have not earned.
      </p>
    </Card>
  );
}
