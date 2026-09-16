import type { FitLabel, GpaScale } from '../types';

export const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

export const round = (n: number) => Math.round(n * 10) / 10;

/** Linear interpolation between two anchor points, clamped to [0, 100]. */
export function scale(value: number, lowIn: number, highIn: number, lowOut = 0, highOut = 100) {
  if (highIn === lowIn) return highOut;
  const t = (value - lowIn) / (highIn - lowIn);
  return clamp(lowOut + t * (highOut - lowOut), Math.min(lowOut, highOut), Math.max(lowOut, highOut));
}

export function labelFor(score: number): FitLabel {
  if (score >= 82) return 'excellent';
  if (score >= 66) return 'good';
  if (score >= 48) return 'moderate';
  return 'weak';
}

/**
 * Normalises any supported grading scale to a 0-100 percentage so the engine can
 * compare a Kazakhstani 5.0 average with an IB 45 and a US 4.0 GPA.
 */
export function normalizeGpa(value: number | null, scaleKey: GpaScale): number | null {
  if (value === null || Number.isNaN(value)) return null;
  switch (scaleKey) {
    case '4.0':
      return clamp((value / 4) * 100);
    case '5.0':
      return clamp((value / 5) * 100);
    case '100':
      return clamp(value);
    case 'IB45':
      // 24 is the IB pass mark, 45 the maximum. Map 24 -> 70, 45 -> 100.
      return clamp(scale(value, 24, 45, 70, 100));
    case 'ALevel':
      // Expressed as an A*-equivalent count on a 0-100 field entered by the user.
      return clamp(value);
    default:
      return clamp(value);
  }
}

/** Converts a TOEFL iBT score to an approximate IELTS band for internal comparison. */
export function toeflToIelts(toefl: number): number {
  if (toefl >= 118) return 9.0;
  if (toefl >= 115) return 8.5;
  if (toefl >= 110) return 8.0;
  if (toefl >= 102) return 7.5;
  if (toefl >= 94) return 7.0;
  if (toefl >= 79) return 6.5;
  if (toefl >= 60) return 6.0;
  if (toefl >= 46) return 5.5;
  return 5.0;
}

/** Converts a Duolingo English Test score to an approximate IELTS band. */
export function duolingoToIelts(det: number): number {
  if (det >= 140) return 8.5;
  if (det >= 130) return 8.0;
  if (det >= 120) return 7.5;
  if (det >= 115) return 7.0;
  if (det >= 105) return 6.5;
  if (det >= 95) return 6.0;
  if (det >= 85) return 5.5;
  return 5.0;
}

export function formatUSD(value: number | null): string {
  if (value === null) return 'Unknown';
  if (value === 0) return '$0';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
