'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Coins,
  GraduationCap,
  Globe2,
  Landmark,
  Loader2,
  SlidersHorizontal,
  Trees,
  User,
} from 'lucide-react';
import { Logo } from '@/components/AppShell';
import { Button, Card } from '@/components/ui';
import { ChipMulti, ChoiceGrid, Field, Slider, TextInput } from '@/components/onboarding/fields';
import { EMPTY_PROFILE } from '@/lib/demo';
import { useApp } from '@/lib/store';
import {
  COUNTRIES,
  MAJORS,
  MAJOR_LABELS,
  type AidNeed,
  type Country,
  type Curriculum,
  type EnglishTest,
  type GpaScale,
  type MajorKey,
  type StudentProfile,
} from '@/lib/types';

const STEPS = [
  { key: 'about', label: 'About you', icon: User },
  { key: 'academic', label: 'Academic profile', icon: GraduationCap },
  { key: 'preferences', label: 'Where to study', icon: Globe2 },
  { key: 'finance', label: 'Budget', icon: Coins },
  { key: 'priorities', label: 'Priorities', icon: SlidersHorizontal },
];

const SUBJECTS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'Informatics',
  'Economics',
  'History',
  'Literature',
  'English',
  'Geography',
  'Art & Design',
];

const HEADINGS = [
  'Tell us about you',
  'Your academic profile',
  'Where would you like to study?',
  'What can your family realistically pay?',
  'What matters most to you?',
];

const SUBHEADINGS = [
  'This sets the baseline we compare every university against.',
  'Nothing here is a judgement. Missing scores are treated as unknown, never as zero.',
  'This is one of the two parameters that changes your results most.',
  'This is the other. Be honest — an unaffordable list helps nobody.',
  'These fine-tune the ranking once the hard constraints are satisfied.',
];

export default function OnboardingPage() {
  const router = useRouter();
  const { profile: saved, setProfile, ready } = useApp();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<StudentProfile>(EMPTY_PROFILE);
  const [submitting, setSubmitting] = useState(false);
  const [touchedGpa, setTouchedGpa] = useState(false);

  /* Resume a previously entered profile rather than making the student retype it. */
  useEffect(() => {
    if (ready && saved.completedAt) setDraft(saved);
  }, [ready, saved]);

  const set = (patch: Partial<StudentProfile>) => setDraft((d) => ({ ...d, ...patch }));

  const gpaMax =
    draft.gpaScale === '4.0' ? 4 : draft.gpaScale === '5.0' ? 5 : draft.gpaScale === 'IB45' ? 45 : 100;
  const gpaValid = draft.gpaValue === null || (draft.gpaValue > 0 && draft.gpaValue <= gpaMax);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return draft.currentCountry.trim().length > 0 && gpaValid;
      case 1:
        return (
          (draft.englishTest === 'none' || draft.englishScore !== null) &&
          (!draft.satTaken || draft.satScore !== null)
        );
      case 2:
        return draft.openToAnyCountry || draft.preferredCountries.length > 0;
      case 3:
        return draft.budgetAnnualUSD >= 0 && draft.maxAffordableAnnualUSD >= draft.budgetAnnualUSD;
      default:
        return true;
    }
  }, [step, draft, gpaValid]);

  function finish() {
    setSubmitting(true);
    setProfile({ ...draft, completedAt: new Date().toISOString() });
    // Brief, honest pause for the transition — the engine itself is instant.
    setTimeout(() => router.push('/diagnostics'), 420);
  }

  function next() {
    if (!stepValid) return;
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      finish();
    }
  }

  function back() {
    if (step === 0) {
      router.push('/');
      return;
    }
    setStep((s) => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const Icon = STEPS[step].icon;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] w-full max-w-[720px] items-center justify-between px-5">
          <Logo />
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Clock3 size={13} /> About 2 minutes
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[720px] px-5 pb-32 pt-8">
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.09em] text-faint">
              Step {step + 1} of {STEPS.length}
            </span>
            <span className="text-[12.5px] font-medium text-muted">{STEPS[step].label}</span>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                aria-label={`Step ${i + 1}: ${s.label}`}
                className={`h-1.5 flex-1 rounded-full transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  i < step
                    ? 'cursor-pointer bg-ink hover:opacity-70'
                    : i === step
                      ? 'bg-brand-500'
                      : 'bg-line'
                }`}
              />
            ))}
          </div>
        </div>

        <div key={step} className="ap-rise">
          <div className="mb-7 flex items-start gap-3.5">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-brand-50 text-brand-600">
              <Icon size={18} strokeWidth={2} />
            </span>
            <div>
              <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-ink sm:text-[30px]">
                {HEADINGS[step]}
              </h1>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{SUBHEADINGS[step]}</p>
            </div>
          </div>

          <div className="space-y-7">
            {step === 0 && (
              <>
                <Field label="Your first name" optional hint="Only used to greet you on the dashboard.">
                  <TextInput
                    value={draft.name}
                    onChange={(v) => set({ name: v })}
                    placeholder="e.g. Aizhan"
                    ariaLabel="First name"
                  />
                </Field>

                <Field label="Where do you live now?">
                  <TextInput
                    value={draft.currentCountry}
                    onChange={(v) => set({ currentCountry: v })}
                    placeholder="e.g. Kazakhstan"
                    ariaLabel="Current country"
                  />
                </Field>

                <Field label="Current year of school">
                  <ChoiceGrid
                    columns={4}
                    value={draft.gradeYear}
                    onChange={(v) => set({ gradeYear: v })}
                    choices={[
                      { value: 'Grade 10', label: 'Grade 10' },
                      { value: 'Grade 11', label: 'Grade 11' },
                      { value: 'Grade 12', label: 'Grade 12' },
                      { value: 'Graduated', label: 'Graduated' },
                    ]}
                  />
                </Field>

                <Field label="Curriculum">
                  <ChoiceGrid
                    columns={3}
                    value={draft.curriculum}
                    onChange={(v) => set({ curriculum: v as Curriculum })}
                    choices={[
                      { value: 'National', label: 'National' },
                      { value: 'IB', label: 'IB Diploma' },
                      { value: 'A-Level', label: 'A-Level' },
                      { value: 'AP / US High School', label: 'AP / US' },
                      { value: 'Other', label: 'Other' },
                    ]}
                  />
                </Field>

                <Field
                  label="Academic average"
                  hint="Pick the scale your school uses. We normalise everything internally so an IB 38 and a 95% average are compared fairly."
                >
                  <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
                    <TextInput
                      type="number"
                      value={draft.gpaValue === null ? '' : String(draft.gpaValue)}
                      onChange={(v) => {
                        setTouchedGpa(true);
                        set({ gpaValue: v === '' ? null : Number(v) });
                      }}
                      placeholder={
                        draft.gpaScale === 'IB45' ? 'e.g. 38' : draft.gpaScale === '4.0' ? 'e.g. 3.8' : 'e.g. 92'
                      }
                      min={0}
                      max={gpaMax}
                      step={draft.gpaScale === '4.0' || draft.gpaScale === '5.0' ? 0.1 : 1}
                      invalid={touchedGpa && !gpaValid}
                      ariaLabel="Academic average"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ['100', '/100'],
                          ['5.0', '/5.0'],
                          ['4.0', '/4.0'],
                          ['IB45', 'IB /45'],
                        ] as [GpaScale, string][]
                      ).map(([scaleKey, label]) => (
                        <button
                          key={scaleKey}
                          type="button"
                          onClick={() => set({ gpaScale: scaleKey })}
                          className={`h-11 rounded-[10px] border px-3 text-[13px] font-medium transition-colors duration-200 ${
                            draft.gpaScale === scaleKey
                              ? 'border-ink bg-ink text-white'
                              : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {touchedGpa && !gpaValid && (
                    <p className="mt-2 text-[13px] text-risk-500">
                      Enter a value between 0 and {gpaMax} for this scale.
                    </p>
                  )}
                </Field>

                <Field label="Class rank" optional hint="Leave as unknown if your school does not rank students.">
                  <ChoiceGrid
                    columns={3}
                    value={draft.classRank}
                    onChange={(v) => set({ classRank: v as StudentProfile['classRank'] })}
                    choices={[
                      { value: 'top-1', label: 'Top 1%' },
                      { value: 'top-5', label: 'Top 5%' },
                      { value: 'top-10', label: 'Top 10%' },
                      { value: 'top-25', label: 'Top 25%' },
                      { value: 'other', label: 'Below top 25%' },
                      { value: 'unknown', label: "Don't know" },
                    ]}
                  />
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <Field label="English test">
                  <ChoiceGrid
                    columns={4}
                    value={draft.englishTest}
                    onChange={(v) =>
                      set({
                        englishTest: v as EnglishTest,
                        englishScore: v === 'none' ? null : draft.englishScore,
                        englishPlanned: v === 'none' ? draft.englishPlanned : false,
                      })
                    }
                    choices={[
                      { value: 'IELTS', label: 'IELTS' },
                      { value: 'TOEFL', label: 'TOEFL iBT' },
                      { value: 'Duolingo', label: 'Duolingo' },
                      { value: 'none', label: "Haven't taken it" },
                    ]}
                  />
                </Field>

                {draft.englishTest !== 'none' ? (
                  <Field label="Your score">
                    <TextInput
                      type="number"
                      value={draft.englishScore === null ? '' : String(draft.englishScore)}
                      onChange={(v) => set({ englishScore: v === '' ? null : Number(v) })}
                      placeholder={
                        draft.englishTest === 'IELTS'
                          ? 'e.g. 6.5'
                          : draft.englishTest === 'TOEFL'
                            ? 'e.g. 95'
                            : 'e.g. 120'
                      }
                      step={draft.englishTest === 'IELTS' ? 0.5 : 1}
                      min={0}
                      max={draft.englishTest === 'IELTS' ? 9 : draft.englishTest === 'TOEFL' ? 120 : 160}
                      ariaLabel="English test score"
                    />
                    <p className="mt-2 text-[13px] text-muted">
                      We convert TOEFL and Duolingo to an IELTS-equivalent band so every university is
                      compared on the same scale.
                    </p>
                  </Field>
                ) : (
                  <Card className="p-4">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={draft.englishPlanned}
                        onChange={(e) => set({ englishPlanned: e.target.checked })}
                        className="mt-1 h-4 w-4 accent-[var(--color-ink)]"
                      />
                      <span>
                        <span className="block text-[14px] font-medium text-ink">
                          I plan to take an English test
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-[1.55] text-muted">
                          We&rsquo;ll add a dated test-registration task to your roadmap instead of quietly
                          excluding universities.
                        </span>
                      </span>
                    </label>
                  </Card>
                )}

                <Field label="SAT / ACT">
                  <ChoiceGrid
                    columns={2}
                    value={draft.satTaken}
                    onChange={(v) => set({ satTaken: v, satScore: v ? draft.satScore : null })}
                    choices={[
                      { value: true, label: 'I have an SAT score' },
                      { value: false, label: "I haven't taken it yet", sub: 'Scored as unknown, not zero' },
                    ]}
                  />
                </Field>

                {draft.satTaken && (
                  <Field label="SAT total (400–1600)">
                    <TextInput
                      type="number"
                      value={draft.satScore === null ? '' : String(draft.satScore)}
                      onChange={(v) => set({ satScore: v === '' ? null : Number(v) })}
                      placeholder="e.g. 1420"
                      min={400}
                      max={1600}
                      step={10}
                      ariaLabel="SAT score"
                    />
                  </Field>
                )}

                <Field label="What do you want to study?">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MAJORS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => set({ intendedMajor: m as MajorKey })}
                        className={`rounded-[10px] border px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-all duration-200 ${
                          draft.intendedMajor === m
                            ? 'border-ink bg-ink text-white'
                            : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {MAJOR_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Your strongest subjects" optional hint="Pick up to three.">
                  <ChipMulti
                    choices={SUBJECTS.map((s) => ({ value: s, label: s }))}
                    values={draft.strongestSubjects}
                    onToggle={(s) =>
                      set({
                        strongestSubjects: draft.strongestSubjects.includes(s)
                          ? draft.strongestSubjects.filter((x) => x !== s)
                          : draft.strongestSubjects.length < 3
                            ? [...draft.strongestSubjects, s]
                            : draft.strongestSubjects,
                      })
                    }
                  />
                </Field>
              </>
            )}

            {step === 2 && (
              <>
                <Field
                  label="Preferred countries"
                  hint="Pick as many as you like. This is one of the two levers that changes your recommendations most — you can change it again later without redoing the questionnaire."
                >
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={() => set({ openToAnyCountry: !draft.openToAnyCountry })}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium transition-all duration-200 ${
                        draft.openToAnyCountry
                          ? 'border-ink bg-ink text-white'
                          : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                      }`}
                    >
                      {draft.openToAnyCountry && <Check size={13} strokeWidth={2.6} />}
                      I&rsquo;m open to anywhere
                    </button>
                  </div>
                  <ChipMulti
                    disabled={draft.openToAnyCountry}
                    choices={COUNTRIES.map((c) => ({ value: c, label: c }))}
                    values={draft.preferredCountries}
                    onToggle={(c: Country) =>
                      set({
                        openToAnyCountry: false,
                        preferredCountries: draft.preferredCountries.includes(c)
                          ? draft.preferredCountries.filter((x) => x !== c)
                          : [...draft.preferredCountries, c],
                      })
                    }
                  />
                  {!draft.openToAnyCountry && draft.preferredCountries.length === 0 && (
                    <p className="mt-2.5 text-[13px] text-muted">
                      Select at least one country, or choose &ldquo;open to anywhere&rdquo;.
                    </p>
                  )}
                </Field>

                <Field label="City size" optional>
                  <ChoiceGrid
                    columns={2}
                    value={draft.citySizePreference}
                    onChange={(v) => set({ citySizePreference: v as StudentProfile['citySizePreference'] })}
                    choices={[
                      {
                        value: 'metropolis',
                        label: 'Major metropolis',
                        sub: 'Seoul, New York, Hong Kong',
                        icon: <Building2 size={15} />,
                      },
                      {
                        value: 'large-city',
                        label: 'Large city',
                        sub: 'Munich, Amsterdam',
                        icon: <Landmark size={15} />,
                      },
                      {
                        value: 'mid-size-city',
                        label: 'Mid-size city',
                        sub: 'Edinburgh, Bologna',
                        icon: <Landmark size={15} />,
                      },
                      {
                        value: 'college-town',
                        label: 'College town',
                        sub: 'Quiet, campus-centred',
                        icon: <Trees size={15} />,
                      },
                      { value: 'no-preference', label: 'No preference' },
                    ]}
                  />
                </Field>

                <Field label="Language of instruction">
                  <ChoiceGrid
                    columns={2}
                    value={draft.englishTaughtOnly}
                    onChange={(v) => set({ englishTaughtOnly: v })}
                    choices={[
                      {
                        value: true,
                        label: 'English-taught only',
                        sub: 'Filters out programmes requiring another language',
                      },
                      {
                        value: false,
                        label: "I'm open to learning a language",
                        sub: 'Unlocks lower-cost European systems',
                      },
                    ]}
                  />
                </Field>
              </>
            )}

            {step === 3 && (
              <>
                <Field
                  label="What can your family contribute per year?"
                  hint="Tuition plus living costs, in US dollars. This is the single most influential answer in the questionnaire."
                >
                  <div className="mb-3 flex flex-wrap gap-2">
                    {[0, 5000, 10000, 20000, 35000, 60000].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() =>
                          set({
                            budgetAnnualUSD: v,
                            maxAffordableAnnualUSD: Math.max(v, draft.maxAffordableAnnualUSD),
                          })
                        }
                        className={`rounded-full border px-3.5 py-2 text-[13.5px] font-medium transition-all duration-200 ${
                          draft.budgetAnnualUSD === v
                            ? 'border-ink bg-ink text-white'
                            : 'border-line bg-surface text-ink-soft hover:border-line-strong'
                        }`}
                      >
                        {v === 0 ? 'Nothing' : `$${v.toLocaleString('en-US')}`}
                      </button>
                    ))}
                  </div>
                  <TextInput
                    type="number"
                    value={String(draft.budgetAnnualUSD)}
                    onChange={(v) => set({ budgetAnnualUSD: v === '' ? 0 : Math.max(0, Number(v)) })}
                    suffix="/ year"
                    min={0}
                    step={500}
                    ariaLabel="Annual family contribution in USD"
                  />
                </Field>

                <Field
                  label="Absolute maximum per year"
                  hint="The most you could pay by stretching — loans, savings, relatives. Never below the figure above."
                >
                  <TextInput
                    type="number"
                    value={String(draft.maxAffordableAnnualUSD)}
                    onChange={(v) => set({ maxAffordableAnnualUSD: v === '' ? 0 : Math.max(0, Number(v)) })}
                    suffix="/ year"
                    min={draft.budgetAnnualUSD}
                    step={500}
                    invalid={draft.maxAffordableAnnualUSD < draft.budgetAnnualUSD}
                    ariaLabel="Maximum affordable annual cost in USD"
                  />
                  {draft.maxAffordableAnnualUSD < draft.budgetAnnualUSD && (
                    <p className="mt-2 text-[13px] text-risk-500">
                      Your maximum cannot be lower than your usual contribution.
                    </p>
                  )}
                </Field>

                <Field label="What kind of financial support do you need?">
                  <ChoiceGrid
                    columns={1}
                    value={draft.aidNeed}
                    onChange={(v) => set({ aidNeed: v as AidNeed })}
                    choices={[
                      {
                        value: 'full-ride',
                        label: 'I need tuition AND living costs covered',
                        sub: 'Only a minority of universities offer this to international students — we weight it heavily.',
                      },
                      {
                        value: 'full-tuition',
                        label: 'I need tuition covered; I can fund living costs',
                        sub: 'Opens up universities with full-tuition entrance scholarships.',
                      },
                      {
                        value: 'partial',
                        label: 'A partial scholarship would make it work',
                        sub: 'The most common situation.',
                      },
                      {
                        value: 'none',
                        label: "I don't need a scholarship",
                        sub: 'Cost is not the binding constraint on your list.',
                      },
                    ]}
                  />
                </Field>
              </>
            )}

            {step === 4 && (
              <>
                <Card className="space-y-7 p-5">
                  <Slider
                    label="Research intensity"
                    value={draft.preferences.research}
                    onChange={(v) => set({ preferences: { ...draft.preferences, research: v } })}
                    lowLabel="Practical & teaching-focused"
                    highLabel="Research-intensive"
                  />
                  <Slider
                    label="Global reputation"
                    value={draft.preferences.prestige}
                    onChange={(v) => set({ preferences: { ...draft.preferences, prestige: v } })}
                    lowLabel="Not important"
                    highLabel="Very important"
                  />
                  <Slider
                    label="Scholarship availability"
                    value={draft.preferences.scholarship}
                    onChange={(v) => set({ preferences: { ...draft.preferences, scholarship: v } })}
                    lowLabel="Not important"
                    highLabel="Decisive"
                  />
                  <Slider
                    label="Location and city life"
                    value={draft.preferences.location}
                    onChange={(v) => set({ preferences: { ...draft.preferences, location: v } })}
                    lowLabel="Not important"
                    highLabel="Very important"
                  />
                </Card>

                <Field label="University size" optional>
                  <ChoiceGrid
                    columns={4}
                    value={draft.sizePreference}
                    onChange={(v) => set({ sizePreference: v as StudentProfile['sizePreference'] })}
                    choices={[
                      { value: 'small', label: 'Small' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'large', label: 'Large' },
                      { value: 'no-preference', label: 'No preference' },
                    ]}
                  />
                </Field>

                <Card className="border-brand-100 bg-brand-50 p-5">
                  <h3 className="text-[14.5px] font-semibold text-brand-700">That&rsquo;s everything.</h3>
                  <p className="mt-1.5 text-[13.5px] leading-[1.65] text-brand-700/85">
                    Next you&rsquo;ll see a diagnostic of your profile — strengths, gaps and what they mean —
                    before any university list. You can change any answer later, and your budget and country
                    can be adjusted live on the recommendations screen.
                  </p>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/92 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[720px] items-center justify-between gap-4 px-5 py-3.5">
          <Button variant="ghost" onClick={back} disabled={submitting}>
            <ArrowLeft size={15} /> {step === 0 ? 'Home' : 'Back'}
          </Button>
          <div className="flex items-center gap-3">
            {!stepValid && (
              <span className="hidden text-[12.5px] text-muted sm:inline">
                {step === 2 ? 'Choose a destination to continue' : 'Complete this step to continue'}
              </span>
            )}
            <Button onClick={next} disabled={!stepValid || submitting}>
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Building your route
                </>
              ) : step === STEPS.length - 1 ? (
                <>
                  See my diagnostic <ArrowRight size={15} />
                </>
              ) : (
                <>
                  Continue <ArrowRight size={15} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
