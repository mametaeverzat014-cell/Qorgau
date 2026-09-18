/** Type declarations for the deterministic extractors. */

export interface MoneyCandidate {
  value: number;
  currency: string | null;
  unit: 'per-year' | 'per-semester' | 'per-quarter' | 'per-credit' | 'per-course' | 'per-month' | 'per-week' | 'unqualified';
  isAnnual: boolean;
  excerpt: string;
  /** The sentence that owns the figure; qualifiers are read from here. */
  sentence?: string;
  index: number;
  academicYear?: string | null;
  academicYearAmbiguous?: boolean;
  academicYearCandidates?: string[];
  /** Which piece of page structure the year came from, if any. */
  academicYearSource?: 'table-column' | 'table-row' | 'section' | 'page' | 'common-data-set' | null;
  scope?: 'table' | 'section';
  sectionHeading?: string | null;
  excludedBecause?: string;
}

export interface IeltsCandidate {
  score: number;
  kind: 'overall' | 'section' | 'unqualified';
  excerpt: string;
  index?: number;
}

export interface ScoreCandidate {
  score: number;
  excerpt: string;
  index?: number;
}

export interface DeadlineCandidate {
  date: string;
  kind: 'application' | 'scholarship' | 'early' | 'unqualified';
  excerpt: string;
  index?: number;
}

export interface AidSignal {
  found: boolean;
  excerpt?: string;
  index?: number;
}

export interface AidSignals {
  meetsFullNeed: AidSignal;
  needBlind: AidSignal;
  needAware: AidSignal;
  fullRide: AidSignal;
  fullTuition: AidSignal;
  meritExists: AidSignal;
  anyScholarship: AidSignal;
  /** Wording that positively describes an award as a contest. */
  competitiveAward: AidSignal & { sentence?: string };
  internationalEligible: AidSignal;
  internationalExcluded: AidSignal;
}

export interface TestingPolicyResult {
  policy: 'required' | 'recommended' | 'optional' | 'not-used' | null;
  ambiguous: boolean;
  signals: { policy: string; excerpt: string; index: number }[];
}

export interface AcademicYearResult {
  year: string | null;
  ambiguous: boolean;
  candidates: string[];
}

export interface CommonDataSetResult {
  detected: boolean;
  academicYear: string | null;
  fields: Record<string, { value: number | string; currency?: string | null; excerpt?: string; note?: string }>;
}

export function htmlToText(html: string): string;
export function pageTitle(html: string): string | null;
export function headings(html: string): string[];
export function tables(html: string): string[][][];
export function detectAcademicYear(text: string): AcademicYearResult;
export function extractMoney(text: string): MoneyCandidate[];
export function moneyNear(text: string, keywords: string[]): MoneyCandidate[];
export function extractIELTS(text: string): IeltsCandidate[];
export function extractTOEFL(text: string): ScoreCandidate[];
export function extractTestingPolicy(text: string): TestingPolicyResult;
export function extractAidPolicy(text: string): AidSignals;
export function extractDeadlines(text: string): DeadlineCandidate[];
export function extractCommonDataSet(text: string): CommonDataSetResult;

export function mainContent(html: string | null): { html: string; usedMain: boolean; stripped: boolean };
export function headingSections(html: string | null): Array<{ heading: string; body: string }>;

export function nonCostContext(sentence: string | null | undefined): string | null;

export function extractMoneyScoped(
  html: string,
  keywords: string[],
): MoneyCandidate[];
export function extractMoneyScoped(
  html: string,
  keywords: string[],
  opts: { withExcluded: true },
): { kept: MoneyCandidate[]; excluded: MoneyCandidate[] };

export type ApplicantScope =
  | 'first_year'
  | 'international_first_year'
  | 'general_undergraduate'
  | 'transfer'
  | 'visiting'
  | 'graduate'
  | 'continuing_education'
  | 'study_abroad'
  | 'unknown';

export const APPLICANT_SCOPES: ApplicantScope[];
export const EXCLUDED_SCOPES: ApplicantScope[];
export const FIRST_YEAR_SCOPES: ApplicantScope[];

export interface ApplicantScopeResult {
  scope: ApplicantScope;
  /** The scope with the international facet removed. */
  level: ApplicantScope;
  international: boolean;
  markers: string[];
  excluded: boolean;
}

export function detectApplicantScope(doc?: {
  url?: string;
  title?: string;
  headingList?: string[];
  text?: string;
}): ApplicantScopeResult;

export function scopeServesFirstYear(scope: string): boolean;
