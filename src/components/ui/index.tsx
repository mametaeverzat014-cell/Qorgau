'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-white hover:bg-[#1c2534] active:bg-[#0b0f16] shadow-[0_1px_2px_rgba(16,20,28,0.16)]',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-ink-soft hover:bg-surface-soft',
  ghost: 'bg-transparent text-ink-soft hover:text-ink hover:bg-surface-soft',
  quiet: 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-100',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5',
  md: 'h-11 px-5 text-[14.5px] gap-2',
  lg: 'h-[52px] px-7 text-[16px] gap-2.5',
};

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  title?: string;
  'aria-label'?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  href,
  onClick,
  disabled,
  className = '',
  type = 'button',
  title,
  ...rest
}: ButtonProps) {
  const cls = `inline-flex items-center justify-center rounded-[10px] font-medium transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap ${VARIANT[variant]} ${SIZE[size]} ${className}`;

  if (href && !disabled) {
    return (
      <Link href={href} className={cls} title={title} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} title={title} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
  hover = false,
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return (
    <As
      className={`rounded-[14px] border border-line bg-surface ${
        hover
          ? 'transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-line-strong hover:shadow-[0_6px_24px_-12px_rgba(16,20,28,0.18)]'
          : ''
      } ${className}`}
    >
      {children}
    </As>
  );
}

export function SectionTitle({
  children,
  action,
  hint,
}: {
  children: ReactNode;
  action?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[19px] font-semibold text-ink">{children}</h2>
        {hint && <p className="mt-1 text-[13.5px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'risk';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-soft text-ink-soft border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-100',
  good: 'bg-good-50 text-good-700 border-[#cfe8dd]',
  warn: 'bg-warn-50 text-warn-700 border-[#f3ddb8]',
  risk: 'bg-risk-50 text-risk-500 border-[#f3cfca]',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[12px] font-medium leading-5 ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip — hover and focus, keyboard reachable                       */
/* ------------------------------------------------------------------ */

export function Tooltip({ text, children }: { text: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex items-center text-faint transition-colors hover:text-ink-soft"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
      >
        {children ?? <Info size={14} strokeWidth={2} />}
      </button>
      {open && (
        <span
          role="tooltip"
          className="ap-fade absolute bottom-[calc(100%+8px)] left-1/2 z-50 w-64 -translate-x-1/2 rounded-[10px] border border-line bg-ink px-3 py-2 text-[12.5px] font-normal leading-[1.5] text-white shadow-[0_8px_28px_-8px_rgba(16,20,28,0.4)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Progress bar                                                        */
/* ------------------------------------------------------------------ */

export function ProgressBar({
  percent,
  tone = 'brand',
  height = 8,
  className = '',
}: {
  percent: number;
  tone?: 'brand' | 'good' | 'ink';
  height?: number;
  className?: string;
}) {
  const color =
    tone === 'good' ? 'bg-good-500' : tone === 'ink' ? 'bg-ink' : 'bg-brand-500';
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-surface-soft ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Score ring                                                          */
/* ------------------------------------------------------------------ */

export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const stroke = size >= 56 ? 4 : 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  const color = score >= 74 ? 'var(--color-good-500)' : score >= 58 ? 'var(--color-brand-500)' : 'var(--color-warn-500)';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-soft)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.22,1,0.36,1), stroke 400ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="tnum font-semibold leading-none text-ink"
          style={{ fontSize: size >= 56 ? 16 : 13 }}
        >
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-muted">
          {icon}
        </div>
      )}
      <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
      <p className="mt-2 max-w-md text-[14px] leading-[1.65] text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton — shown only while localStorage hydrates                   */
/* ------------------------------------------------------------------ */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[10px] bg-surface-soft ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Value with source attribution                                       */
/* ------------------------------------------------------------------ */

export function DataPoint({
  label,
  value,
  confidence,
  note,
}: {
  label: string;
  value: string;
  confidence?: 'published' | 'estimate' | 'unknown';
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-3 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <span className="text-[13.5px] text-muted">{label}</span>
      <span className="flex items-center gap-2 text-right">
        <span className="tnum text-[14.5px] font-medium text-ink">{value}</span>
        {confidence === 'estimate' && (
          <Badge tone="neutral" title={note ?? 'Indicative figure compiled for this project — confirm at the official source.'}>
            Estimate
          </Badge>
        )}
        {confidence === 'published' && (
          <Badge tone="good" title="Stated by the institution on its official pages.">
            Published
          </Badge>
        )}
        {confidence === 'unknown' && <Badge tone="warn">Unverified</Badge>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scroll reveal for long pages                                        */
/* ------------------------------------------------------------------ */

export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  /* Content is visible by default and animates in on mount. An earlier version
     gated visibility on IntersectionObserver, which left below-the-fold sections
     invisible whenever the observer never fired (print, screenshots, some
     embedded browsers). Never hide real content behind an optional API. */
  return (
    <div className="ap-rise" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
