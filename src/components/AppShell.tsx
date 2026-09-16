'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Compass, LayoutGrid, Map, Menu, Scale, Sparkles, Trash2, X } from 'lucide-react';
import { useApp } from '@/lib/store';
import { Badge, Button } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/recommendations', label: 'Recommendations', icon: Compass },
  { href: '/compare', label: 'Compare', icon: Scale },
  { href: '/roadmap', label: 'Roadmap', icon: Map },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="AdmitPath AI home">
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-ink text-white transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105">
        <Sparkles size={15} strokeWidth={2.2} />
      </span>
      {!compact && (
        <span className="text-[15.5px] font-semibold tracking-[-0.02em] text-ink">
          AdmitPath <span className="text-muted">AI</span>
        </span>
      )}
    </Link>
  );
}

/**
 * Persistent shell shown on every screen after onboarding.
 * The welcome and onboarding screens render their own minimal header instead so
 * nothing competes with the questionnaire.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { compareIds, progress, hasProfile, clearAllData } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="min-h-screen">
      <header className="ap-no-print sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] w-full max-w-[1180px] items-center gap-6 overflow-hidden px-5">
          <Logo />

          <nav className="hidden min-w-0 items-center gap-1 md:flex">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-[13.5px] font-medium transition-colors duration-200 ${
                    active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,20,28,0.06)]' : 'text-muted hover:text-ink'
                  }`}
                >
                  <Icon size={15} strokeWidth={2} />
                  {label}
                  {href === '/compare' && compareIds.length > 0 && (
                    <span className="tnum ml-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-500 px-1 text-[10.5px] font-semibold text-white">
                      {compareIds.length}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {hasProfile && (
              <div className="hidden items-center gap-2.5 lg:flex" title="Share of your application route completed">
                <span className="text-[12.5px] text-muted">Route</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-soft">
                  <div
                    className="h-full rounded-full bg-ink transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ width: `${progress.overallPercent}%` }}
                  />
                </div>
                <span className="tnum text-[12.5px] font-semibold text-ink">{progress.overallPercent}%</span>
              </div>
            )}
            <button
              className="flex h-9 w-9 items-center justify-center rounded-[9px] text-muted transition-colors hover:bg-surface hover:text-ink md:hidden"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="ap-fade border-t border-line bg-surface px-5 py-2 md:hidden">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-[9px] px-2 py-3 text-[14.5px] font-medium text-ink-soft"
              >
                <Icon size={16} strokeWidth={2} />
                {label}
                {href === '/compare' && compareIds.length > 0 && (
                  <Badge tone="brand">{compareIds.length}</Badge>
                )}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main>{children}</main>

      <footer className="ap-no-print mt-20 border-t border-line">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-md">
              <Logo />
              <p className="mt-3 text-[13px] leading-[1.7] text-muted">
                AdmitPath is a decision-support tool, not an admissions authority. Match scores describe
                alignment with the profile you entered — they are never a prediction of admission. Costs
                are indicative estimates; always confirm figures and deadlines at the official source
                links we provide on every university.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3">
              <span className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-faint">
                Your data
              </span>
              <p className="max-w-[240px] text-[13px] leading-[1.6] text-muted">
                Everything you enter stays in this browser. Nothing is sent to a server or an account.
              </p>
              {confirmClear ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      clearAllData();
                      setConfirmClear(false);
                      window.location.href = '/';
                    }}
                  >
                    Yes, delete everything
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                  <Trash2 size={14} /> Clear my data
                </Button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
