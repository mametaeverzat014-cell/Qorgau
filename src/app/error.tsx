'use client';

import { useEffect } from 'react';

/**
 * Last line of defence.
 *
 * Validated storage should prevent the known crash paths, but a judge hitting a
 * white screen mid-demo is the worst possible failure, so anything that still
 * escapes lands here with a way out. The recovery action clears persisted state,
 * because a poisoned profile is by far the most likely cause.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Surfaced for whoever is debugging; never shown raw to the student.
    console.error('AdmitPath recovered from a render error:', error);
  }, [error]);

  function clearAndRestart() {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('admitpath'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable — reloading is still worth a try */
    }
    window.location.href = '/';
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.09em] text-[#98a0ad]">
          Something went wrong
        </p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.025em] text-[#10141c]">
          We couldn&rsquo;t render this screen
        </h1>
        <p className="mt-3 text-[14.5px] leading-[1.65] text-[#6c7686]">
          This is usually caused by saved data from an older version of AdmitPath. Trying again is
          safe; if it keeps happening, resetting clears the saved profile and starts fresh.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <button
            onClick={reset}
            className="inline-flex h-11 items-center rounded-[10px] bg-[#10141c] px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-[#1c2534]"
          >
            Try again
          </button>
          <button
            onClick={clearAndRestart}
            className="inline-flex h-11 items-center rounded-[10px] border border-[#d6d5cf] bg-white px-5 text-[14.5px] font-medium text-[#10141c] transition-colors hover:bg-[#f5f5f2]"
          >
            Reset my data and start over
          </button>
        </div>
      </div>
    </div>
  );
}
