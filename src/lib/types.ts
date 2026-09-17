/**
 * AdmitPath AI — domain model.
 *
 * Everything the recommendation engine touches is described here. The engine is
 * deliberately framework-free so it can be unit-tested as pure functions.
 */

/* ------------------------------------------------------------------ */
/* Geography                                                           */
/* ------------------------------------------------------------------ */

export const COUNTRIES = [
  'USA',
  'South Korea',
  'Hong Kong',
  'Singapore',
  'Japan',
  'Germany',
  'Netherlands',
  'Italy',
  'Austria',
  'Czechia',
  'Poland',
  'United Kingdom',
  'France',
  'UAE',
  'Kazakhstan',
] as const;
export type Country = (typeof COUNTRIES)[number];

export const REGIONS = [
  'North America',
  'East Asia',
  'Southeast Asia',
  'Europe',
  'Middle East',
  'Central Asia',
] as const;
export type Region = (typeof REGIONS)[number];

/** Region groups exposed in the UI as one-click country filters. */
export const REGION_COUNTRIES: Record<Region, Country[]> = {
  'North America': ['USA'],
  'East Asia': ['South Korea', 'Hong Kong', 'Japan'],
  'Southeast Asia': ['Singapore'],
  Europe: [
    'Germany',
    'Netherlands',
    'Italy',
    'Austria',
    'Czechia',
    'Poland',
    'United Kingdom',
    'France',
  ],
  'Middle East': ['UAE'],
  'Central Asia': ['Kazakhstan'],
};

/* ------------------------------------------------------------------ */
/* Majors                                                              */
/* ------------------------------------------------------------------ */

export const MAJORS = [
  'computer-science',
  'data-science-ai',
  'engineering',
  'mathematics',
  'physics',
  'biology-life-sciences',
  'medicine-health',
  'economics',
  'business-management',
  'finance-accounting',
  'law',
  'political-science-ir',
  'psychology',
  'design-architecture',
  'media-communication',
  'humanities',
  'environmental-science',
] as const;
export type MajorKey = (typeof MAJORS)[number];

export const MAJOR_LABELS: Record<MajorKey, string> = {
  'computer-science': 'Computer Science',
  'data-science-ai': 'Data Science & AI',
  engineering: 'Engineering',
  mathematics: 'Mathematics',
  physics: 'Physics',
  'biology-life-sciences': 'Biology & Life Sciences',
  'medicine-health': 'Medicine & Health Sciences',
  economics: 'Economics',
  'business-management': 'Business & Management',
  'finance-accounting': 'Finance & Accounting',
  law: 'Law',
  'political-science-ir': 'Political Science & International Relations',
  psychology: 'Psychology',
  'design-architecture': 'Design & Architecture',
  'media-communication': 'Media & Communication',
  humanities: 'Humanities',
  'environmental-science': 'Environmental Science',
};

/**
 * Adjacency clusters. A student aiming at one major still gets partial credit at
 * a university that teaches a neighbouring field — this is what stops the engine
 * from behaving like a binary keyword filter.
 */
export const MAJOR_CLUSTERS: MajorKey[][] = [
  ['computer-science', 'data-science-ai', 'mathematics', 'engineering'],
  ['engineering', 'physics', 'mathematics', 'environmental-science'],
  ['economics', 'finance-accounting', 'business-management', 'mathematics'],
  ['business-management', 'media-communication', 'design-architecture'],
  ['political-science-ir', 'law', 'humanities', 'economics'],
  ['psychology', 'biology-life-sciences', 'medicine-health'],
  ['biology-life-sciences', 'environmental-science', 'medicine-health'],
  ['humanities', 'media-communication', 'psychology'],
];

/* ------------------------------------------------------------------ */
/* Data confidence                                                     */
/* ------------------------------------------------------------------ */

/**
 * Provenance vocabulary.
 *
 * There is deliberately no "published" status. Claiming a value is published by
 * an institution asserts something we did not verify against that institution's
 * live pages, and an earlier version of this dataset proved how that goes: URLs
 * written from memory returned 404 in production. A judge can disprove a false
 * "Published" badge in thirty seconds, and in the one category that matters most
 * that costs far more than the badge was ever worth.
 *
 *  - `curated`    compiled from the institution's public materials when the
 *                 dataset was assembled, and not re-verified since
 *  - `estimated`  AdmitPath's own indicative figure, not quoted from anyone
 *  - `unverified` we do not know, and the value is null
 */
export type Confidence = 'curated' | 'estimated' | 'unverified';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  curated: 'Curated',
  estimated: 'Estimate',
  unverified: 'Unverified',
};

export const CONFIDENCE_TOOLTIPS: Record<Confidence, string> = {
  curated:
    'Compiled from this institution\u2019s public materials when our dataset was assembled, and not re-verified since. Confirm it on the official site before you rely on it.',
  estimated:
    'An indicative figure produced by AdmitPath for planning, not a number quoted by the institution. Costs vary by programme, citizenship and year.',
  unverified:
    'We could not establish this value, so we show nothing rather than inventing a plausible number.',
};

/**
 * Per-institution provenance. Kept as one small record rather than wrapping every
 * field in an object: it carries the same information for the UI and the tests
 * without churning the whole dataset shape.
 */
export interface UniversityProvenance {
  /** ISO date the record was compiled. Shown in the UI as "Last reviewed". */
  compiledOn: string;
  /** Entry requirements: English minimums, test policy, application platform. */
  requirements: Confidence;
  /** Tuition and living costs. */
  costs: Confidence;
  /** Application and scholarship deadlines. */
  deadlines: Confidence;
  /** Scholarship and financial-aid policy. */
  aid: Confidence;
}

export interface Money {
  /** Annual figure in USD. `null` means we could not verify it. */
  value: number | null;
  confidence: Confidence;
  note?: string;
}

export type ScholarshipAvailability =
  | 'extensive'
  | 'moderate'
  | 'limited'
  | 'rare-for-international'
  | 'unknown';

/**
 * How RELIABLE the aid is, independently of how large it is.
 *
 * This axis exists because `fullRidePossible` alone was misleading: it grouped
 * institutions that commit to meeting the full demonstrated need of every
 * admitted international with institutions that award a handful of competitive
 * scholarships a year. For a student with no money that difference is the whole
 * decision, so the engine models it explicitly.
 */
export type AidCertainty =
  /** States it meets the full demonstrated need of admitted internationals. */
  | 'meets-full-need'
  /** Low or zero cost is the default for everyone admitted, not a competition. */
  | 'structural'
  /** Awards exist and can be large, but you must win them against a field. */
  | 'competitive'
  /** Little or nothing published for international undergraduates. */
  | 'minimal';

export const AID_CERTAINTY_LABELS: Record<AidCertainty, string> = {
  'meets-full-need': 'Meets full demonstrated need',
  structural: 'Low cost by default',
  competitive: 'Competitive award',
  minimal: 'Minimal aid for internationals',
};

export type Selectivity = 'highly-selective' | 'selective' | 'moderate' | 'accessible';

export type SatPolicy = 'required' | 'recommended' | 'optional' | 'not-used' | 'unknown';

export type CitySize = 'metropolis' | 'large-city' | 'mid-size-city' | 'college-town';
export type CampusEnvironment = 'urban' | 'suburban' | 'campus-town';
export type UniversitySize = 'small' | 'medium' | 'large';
export type Climate = 'cold' | 'temperate' | 'warm' | 'humid-subtropical';

export interface UniversitySources {
  admissions: string;
  tuition: string;
  scholarships: string;
}

export interface University {
  id: string;
  name: string;
  shortName: string;
  country: Country;
  region: Region;
  city: string;
  citySize: CitySize;
  environment: CampusEnvironment;
  climate: Climate;
  size: UniversitySize;
  languagesOfInstruction: string[];
  /** Human-readable programme names shown in the UI. */
  programs: string[];
  supportedMajors: MajorKey[];
  /** 1 = teaching-focused/practical, 5 = research-intensive. */
  researchIntensity: 1 | 2 | 3 | 4 | 5;
  /** 1 = regional reputation, 5 = globally recognised brand. */
  prestigeTier: 1 | 2 | 3 | 4 | 5;

  estimatedTuition: Money;
  estimatedLivingCost: Money;

  scholarshipAvailability: ScholarshipAvailability;
  /** Tuition + living covered for an international undergraduate. */
  fullRidePossible: boolean | null;
  /** Tuition covered, living costs still on the family. */
  fullTuitionPossible: boolean | null;
  needBasedAidForInternationals: boolean | null;
  /** How dependable the aid above is. See AidCertainty. */
  aidCertainty: AidCertainty;
  aidNote: string;

  minimumIELTS: number | null;
  recommendedIELTS: number | null;
  minimumTOEFL: number | null;
  satPolicy: SatPolicy;
  minimumSAT: number | null;
  recommendedSAT: number | null;
  /** Typical competitive secondary-school average, normalised to a 0-100 scale. */
  gpaExpectation: number;

  admissionSelectivity: Selectivity;
  selectivityNote: string;

  /** ISO date of the main international undergraduate deadline (year-agnostic cycle). */
  applicationDeadline: string | null;
  scholarshipDeadline: string | null;
  applicationPlatform: string;

  officialUrl: string;
  scholarshipUrl: string;
  sources: UniversitySources;
  /** Where each class of fact on this record came from, and when. */
  provenance: UniversityProvenance;

  highlights: string[];
}

/* ------------------------------------------------------------------ */
/* Student profile                                                     */
/* ------------------------------------------------------------------ */

export type GpaScale = '4.0' | '5.0' | '100' | 'IB45' | 'ALevel';
export type Curriculum = 'National' | 'IB' | 'A-Level' | 'AP / US High School' | 'Other';
export type EnglishTest = 'IELTS' | 'TOEFL' | 'Duolingo' | 'none';
export type AidNeed = 'full-ride' | 'full-tuition' | 'partial' | 'none';
export type ClassRank = 'top-1' | 'top-5' | 'top-10' | 'top-25' | 'other' | 'unknown';

export interface PreferenceWeights {
  /** Each 0-100. The student sets these with sliders in step E. */
  research: number;
  prestige: number;
  scholarship: number;
  location: number;
  campusLife: number;
}

export interface StudentProfile {
  /** Optional first name, only used for the greeting. */
  name: string;
  currentCountry: string;
  gradeYear: string;
  graduationYear: number;
  curriculum: Curriculum;
  gpaValue: number | null;
  gpaScale: GpaScale;
  classRank: ClassRank;

  englishTest: EnglishTest;
  englishScore: number | null;
  /** True when the student intends to sit the test but has no score yet. */
  englishPlanned: boolean;

  satTaken: boolean;
  /** `null` means NOT TAKEN — never treated as zero. */
  satScore: number | null;
  actTaken: boolean;
  actScore: number | null;

  strongestSubjects: string[];
  academicInterests: string[];
  intendedMajor: MajorKey;

  preferredCountries: Country[];
  /** True when the student is open to anywhere — disables the geography focus penalty. */
  openToAnyCountry: boolean;
  citySizePreference: CitySize | 'no-preference';
  environmentPreference: CampusEnvironment | 'no-preference';
  sizePreference: UniversitySize | 'no-preference';
  englishTaughtOnly: boolean;

  /** What the family can contribute per year, in USD. */
  budgetAnnualUSD: number;
  /** Absolute ceiling per year, in USD. Always >= budgetAnnualUSD. */
  maxAffordableAnnualUSD: number;
  aidNeed: AidNeed;

  preferences: PreferenceWeights;

  /** Set once the questionnaire has been completed at least once. */
  completedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Engine output                                                       */
/* ------------------------------------------------------------------ */

export type FitLabel =
  | 'excellent'
  | 'good'
  | 'moderate'
  | 'weak'
  | 'unknown';

export interface FitResult {
  /** 0-100 alignment score. Never an admission probability. */
  score: number;
  label: FitLabel;
  reasons: string[];
  concerns: string[];
  /** Short machine-readable facts other engines (roadmap, diagnostics) consume. */
  flags: string[];
}

export type FinancialVerdict =
  /** Sticker cost already sits inside what the family can pay. */
  | 'strong-financial-fit'
  /** Needs aid, but the institution commits to meeting need or is low-cost by default. */
  | 'potentially-affordable-with-aid'
  /** Needs aid, and that aid is a competitive award the student must win. */
  | 'aid-dependent'
  /** Out of reach even at the most favourable realistic aid outcome. */
  | 'above-budget'
  /** Cost data could not be verified. */
  | 'unknown';

/** True when the plan only works if funding comes through. */
export function requiresAid(verdict: FinancialVerdict): boolean {
  return verdict === 'potentially-affordable-with-aid' || verdict === 'aid-dependent';
}

export interface FinancialFitResult extends FitResult {
  verdict: FinancialVerdict;
  /** Published/estimated sticker cost per year (tuition + living), or null. */
  totalAnnualCost: number | null;
  /** Realistic best-case annual out-of-pocket cost after plausible aid, or null. */
  bestCaseNetCost: number | null;
  /** Annual gap between best-case net cost and what the family can pay. */
  fundingGap: number | null;
  /** How dependable the aid this verdict relies on actually is. */
  aidCertainty: AidCertainty;
}

export type MatchCategory = 'strong' | 'possible' | 'ambitious';

export interface ScoreComponents {
  academic: number;
  financial: number;
  major: number;
  geography: number;
  scholarship: number;
  tests: number;
  preference: number;
}

export interface Recommendation {
  university: University;
  /** Weighted match score, 0-100. Alignment with the stated profile, NOT admission odds. */
  score: number;
  category: MatchCategory;
  components: ScoreComponents;
  fits: {
    academic: FitResult;
    financial: FinancialFitResult;
    major: FitResult;
    geography: FitResult;
    scholarship: FitResult;
    tests: FitResult;
    preference: FitResult;
  };
  /** De-duplicated "why it matches" bullets. */
  reasons: string[];
  /** De-duplicated "watch out" bullets. */
  concerns: string[];
  /** Full-sentence explanation generated by the explanation engine. */
  summary: string;
  /** True when the university sits outside the student's preferred countries. */
  outsidePreferredCountries: boolean;
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

export type DiagnosticLevel =
  | 'strong'
  | 'ready'
  | 'moderate'
  | 'needs-improvement'
  | 'limited'
  | 'very-high'
  | 'competitive'
  | 'unknown';

export interface DiagnosticDimension {
  key: string;
  label: string;
  level: DiagnosticLevel;
  /** 0-100, used only for the bar width. */
  value: number;
  detail: string;
}

export interface Diagnostics {
  dimensions: DiagnosticDimension[];
  insights: string[];
  gaps: ProfileGap[];
}

export type GapKey =
  | 'english-missing'
  | 'english-below'
  | 'sat-missing'
  | 'sat-below'
  | 'gpa-missing'
  | 'funding-gap'
  | 'scholarship-dependence'
  | 'narrow-geography'
  | 'no-results';

export interface ProfileGap {
  key: GapKey;
  title: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

/* ------------------------------------------------------------------ */
/* Roadmap, next action, progress                                      */
/* ------------------------------------------------------------------ */

export type TaskCategory =
  | 'shortlist'
  | 'tests'
  | 'documents'
  | 'applications'
  | 'scholarships';

export type TaskPriority = 'critical' | 'high' | 'normal';

export interface RoadmapTask {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  /** ISO date. */
  dueDate: string;
  /** Month bucket label, e.g. "September 2026". */
  monthKey: string;
  priority: TaskPriority;
  relatedUniversityId?: string;
  relatedUniversityName?: string;
  /** Explains why the task exists — always derived from the profile. */
  rationale: string;
}

export interface RoadmapMonth {
  monthKey: string;
  label: string;
  tasks: RoadmapTask[];
}

export interface NextAction {
  task: RoadmapTask;
  why: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface TrackProgress {
  key: TaskCategory | 'profile';
  label: string;
  percent: number;
  completed: number;
  total: number;
}

export interface ProgressSnapshot {
  tracks: TrackProgress[];
  overallPercent: number;
  completedTasks: number;
  totalTasks: number;
}
