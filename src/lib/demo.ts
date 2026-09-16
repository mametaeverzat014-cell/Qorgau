import type { StudentProfile } from './types';

export const EMPTY_PROFILE: StudentProfile = {
  name: '',
  currentCountry: 'Kazakhstan',
  gradeYear: 'Grade 11',
  graduationYear: 2027,
  curriculum: 'National',
  gpaValue: null,
  gpaScale: '100',
  classRank: 'unknown',
  englishTest: 'none',
  englishScore: null,
  englishPlanned: false,
  satTaken: false,
  satScore: null,
  actTaken: false,
  actScore: null,
  strongestSubjects: [],
  academicInterests: [],
  intendedMajor: 'computer-science',
  preferredCountries: [],
  openToAnyCountry: true,
  citySizePreference: 'no-preference',
  environmentPreference: 'no-preference',
  sizePreference: 'no-preference',
  englishTaughtOnly: true,
  budgetAnnualUSD: 10000,
  maxAffordableAnnualUSD: 15000,
  aidNeed: 'partial',
  preferences: { research: 50, prestige: 50, scholarship: 60, location: 50, campusLife: 50 },
  completedAt: null,
};

export interface DemoProfile {
  id: string;
  label: string;
  tagline: string;
  blurb: string;
  profile: StudentProfile;
}

/**
 * Three bundled demo students so a judge can see the full journey without typing
 * a questionnaire. Each one exercises a different branch of the engine:
 * high-achieving and scholarship-dependent, mid-budget and test-light, and
 * high-budget and location-flexible.
 */
export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: 'aizhan',
    label: 'Aizhan — high achiever, needs a full ride',
    tagline: 'Kazakhstan · Economics · IELTS 7.0 · SAT 1450 · Full scholarship required',
    blurb:
      'Strong academics but the family can contribute almost nothing. Tests how the engine handles full-cost funding dependence.',
    profile: {
      ...EMPTY_PROFILE,
      name: 'Aizhan',
      currentCountry: 'Kazakhstan',
      gradeYear: 'Grade 12',
      graduationYear: 2027,
      curriculum: 'National',
      gpaValue: 95,
      gpaScale: '100',
      classRank: 'top-5',
      englishTest: 'IELTS',
      englishScore: 7.0,
      englishPlanned: false,
      satTaken: true,
      satScore: 1450,
      strongestSubjects: ['Mathematics', 'Economics', 'English'],
      academicInterests: ['Development economics', 'Public policy'],
      intendedMajor: 'economics',
      preferredCountries: ['USA', 'Hong Kong'],
      openToAnyCountry: false,
      citySizePreference: 'no-preference',
      environmentPreference: 'no-preference',
      sizePreference: 'no-preference',
      englishTaughtOnly: true,
      budgetAnnualUSD: 2000,
      maxAffordableAnnualUSD: 5000,
      aidNeed: 'full-ride',
      preferences: { research: 75, prestige: 80, scholarship: 95, location: 40, campusLife: 55 },
      completedAt: null,
    },
  },
  {
    id: 'daniyar',
    label: 'Daniyar — mid budget, no SAT yet',
    tagline: 'Computer Science · South Korea · IELTS 6.5 · No SAT · $15,000/year',
    blurb:
      'A realistic middle case: decent but not exceptional scores, a real family budget, and one target country. Tests the missing-SAT logic.',
    profile: {
      ...EMPTY_PROFILE,
      name: 'Daniyar',
      currentCountry: 'Kazakhstan',
      gradeYear: 'Grade 11',
      graduationYear: 2027,
      curriculum: 'National',
      gpaValue: 88,
      gpaScale: '100',
      classRank: 'top-10',
      englishTest: 'IELTS',
      englishScore: 6.5,
      englishPlanned: false,
      satTaken: false,
      satScore: null,
      strongestSubjects: ['Mathematics', 'Physics', 'Informatics'],
      academicInterests: ['Machine learning', 'Software engineering'],
      intendedMajor: 'computer-science',
      preferredCountries: ['South Korea'],
      openToAnyCountry: false,
      citySizePreference: 'metropolis',
      environmentPreference: 'no-preference',
      sizePreference: 'no-preference',
      englishTaughtOnly: true,
      budgetAnnualUSD: 12000,
      maxAffordableAnnualUSD: 15000,
      aidNeed: 'partial',
      preferences: { research: 60, prestige: 60, scholarship: 70, location: 65, campusLife: 50 },
      completedAt: null,
    },
  },
  {
    id: 'madina',
    label: 'Madina — high budget, flexible location',
    tagline: 'Business · Europe or Asia · IELTS 7.5 · $45,000/year · No aid needed',
    blurb:
      'Money is not the constraint here, so preference and programme fit dominate the ranking. Tests the engine without the budget filter.',
    profile: {
      ...EMPTY_PROFILE,
      name: 'Madina',
      currentCountry: 'Kazakhstan',
      gradeYear: 'Grade 12',
      graduationYear: 2027,
      curriculum: 'IB',
      gpaValue: 38,
      gpaScale: 'IB45',
      classRank: 'top-10',
      englishTest: 'IELTS',
      englishScore: 7.5,
      englishPlanned: false,
      satTaken: true,
      satScore: 1380,
      strongestSubjects: ['Business Management', 'Economics', 'English'],
      academicInterests: ['Entrepreneurship', 'International business'],
      intendedMajor: 'business-management',
      preferredCountries: [],
      openToAnyCountry: true,
      citySizePreference: 'metropolis',
      environmentPreference: 'urban',
      sizePreference: 'no-preference',
      englishTaughtOnly: true,
      budgetAnnualUSD: 40000,
      maxAffordableAnnualUSD: 55000,
      aidNeed: 'none',
      preferences: { research: 35, prestige: 85, scholarship: 20, location: 80, campusLife: 70 },
      completedAt: null,
    },
  },
];

export function getDemoProfile(id: string): StudentProfile | null {
  const found = DEMO_PROFILES.find((d) => d.id === id);
  if (!found) return null;
  return { ...found.profile, completedAt: new Date().toISOString() };
}
