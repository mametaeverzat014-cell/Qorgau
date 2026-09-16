'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Field shell                                                         */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  optional,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <label className="text-[14px] font-medium text-ink">{label}</label>
        {optional && <span className="text-[12px] text-faint">Optional</span>}
      </div>
      {hint && <p className="mb-2.5 text-[13px] leading-[1.55] text-muted">{hint}</p>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Choice cards — the primary input pattern                            */
/* ------------------------------------------------------------------ */

export interface Choice<T> {
  value: T;
  label: string;
  sub?: string;
  icon?: ReactNode;
}

export function ChoiceGrid<T extends string | number | boolean>({
  choices,
  value,
  onChange,
  columns = 2,
}: {
  choices: Choice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3 | 4;
}) {
  const cols =
    columns === 1
      ? 'grid-cols-1'
      : columns === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : columns === 3
          ? 'grid-cols-2 sm:grid-cols-3'
          : 'grid-cols-2 sm:grid-cols-4';

  return (
    <div className={`grid gap-2.5 ${cols}`}>
      {choices.map((c) => {
        const active = value === c.value;
        return (
          <button
            key={String(c.value)}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={active}
            className={`group relative flex items-start gap-3 rounded-[12px] border p-3.5 text-left transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              active
                ? 'border-ink bg-ink text-white shadow-[0_2px_10px_-4px_rgba(16,20,28,0.35)]'
                : 'border-line bg-surface hover:border-line-strong hover:bg-surface-soft'
            }`}
          >
            {c.icon && (
              <span className={active ? 'mt-[1px] text-white/80' : 'mt-[1px] text-muted'}>{c.icon}</span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-[1.4]">{c.label}</span>
              {c.sub && (
                <span
                  className={`mt-0.5 block text-[12.5px] leading-[1.5] ${active ? 'text-white/65' : 'text-muted'}`}
                >
                  {c.sub}
                </span>
              )}
            </span>
            {active && <Check size={15} strokeWidth={2.5} className="mt-[2px] shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-select variant used for countries and subjects. */
export function ChipMulti<T extends string>({
  choices,
  values,
  onToggle,
  disabled = false,
}: {
  choices: Choice<T>[];
  values: T[];
  onToggle: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((c) => {
        const active = values.includes(c.value);
        return (
          <button
            key={c.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(c.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition-all duration-200 disabled:opacity-40 ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {active && <Check size={13} strokeWidth={2.6} />}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Text / number input                                                 */
/* ------------------------------------------------------------------ */

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  suffix,
  min,
  max,
  step,
  invalid,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="relative">
      <input
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-11 w-full rounded-[10px] border bg-surface px-3.5 text-[14.5px] text-ink outline-none transition-colors duration-200 placeholder:text-faint focus:border-brand-500 ${
          invalid ? 'border-risk-500' : 'border-line'
        } ${suffix ? 'pr-16' : ''}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slider                                                              */
/* ------------------------------------------------------------------ */

export function Slider({
  value,
  onChange,
  label,
  lowLabel,
  highLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[14px] font-medium text-ink">{label}</span>
        <span className="tnum text-[12.5px] font-medium text-muted">{value}%</span>
      </div>
      <input
        type="range"
        className="ap-range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mt-1.5 flex justify-between text-[12px] text-faint">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
