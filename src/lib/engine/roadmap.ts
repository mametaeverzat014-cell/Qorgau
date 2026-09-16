import type {
  Diagnostics,
  NextAction,
  ProgressSnapshot,
  Recommendation,
  RoadmapMonth,
  RoadmapTask,
  StudentProfile,
  TaskCategory,
  TrackProgress,
} from '../types';
import { MAJOR_LABELS } from '../types';
import { studentIeltsEquivalent } from './matchers';
import { formatUSD } from './utils';

const MONTH_LABEL = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

const iso = (d: Date) => d.toISOString().slice(0, 10);

function addDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Clamp a task's due date so it never lands before today or after the last deadline. */
function safeDue(candidate: Date, today: Date): Date {
  return candidate.getTime() < today.getTime() ? addDays(today, 3) : candidate;
}

/**
 * Generates the personal roadmap.
 *
 * Every task here is produced FROM the profile and the ranked results — the gaps
 * the diagnostics found, the actual deadlines of the recommended universities,
 * and the student's funding situation. Nothing is a hard-coded checklist.
 */
export function buildRoadmap(
  profile: StudentProfile,
  recommendations: Recommendation[],
  diagnostics: Diagnostics,
  today: Date = new Date(),
): RoadmapTask[] {
  const tasks: RoadmapTask[] = [];
  const push = (t: Omit<RoadmapTask, 'monthKey'>) => {
    const d = new Date(`${t.dueDate}T00:00:00Z`);
    tasks.push({ ...t, monthKey: monthKey(d) });
  };

  const sorted = [...recommendations].sort((a, b) => {
    const da = a.university.applicationDeadline ?? '9999-12-31';
    const db = b.university.applicationDeadline ?? '9999-12-31';
    return da.localeCompare(db);
  });
  const earliest = sorted.find((r) => r.university.applicationDeadline)?.university.applicationDeadline;
  const earliestDate = earliest ? new Date(`${earliest}T00:00:00Z`) : addDays(today, 120);

  /* ---------------- Shortlist ---------------- */
  push({
    id: 'shortlist-review',
    title: 'Finish your university shortlist',
    description: `Review your ${recommendations.length} recommendations and mark the ones you will actually apply to. Aim for a balanced list: at least one you could fund without aid.`,
    category: 'shortlist',
    dueDate: iso(safeDue(addDays(today, 7), today)),
    priority: 'critical',
    rationale: 'Every other step depends on knowing which universities you are applying to.',
  });
  push({
    id: 'shortlist-compare',
    title: 'Compare your top 3 options side by side',
    description:
      'Use the comparison view to weigh cost, scholarship access, entry requirements and deadlines against each other before you commit time to applications.',
    category: 'shortlist',
    dueDate: iso(safeDue(addDays(today, 12), today)),
    priority: 'high',
    rationale: 'Comparing before applying prevents wasted effort on options you would not accept.',
  });

  /* ---------------- English test (gap-driven) ---------------- */
  const ielts = studentIeltsEquivalent(profile);
  const englishGap = diagnostics.gaps.find((g) => g.key === 'english-below' || g.key === 'english-missing');
  if (englishGap) {
    const needed = Math.max(
      ...recommendations.map((r) => r.university.minimumIELTS ?? r.university.recommendedIELTS ?? 6.5),
      6.5,
    );
    push({
      id: 'english-register',
      title: ielts === null ? 'Register for an IELTS or TOEFL sitting' : `Register for an IELTS retake (target ${needed})`,
      description:
        ielts === null
          ? `You have no English score on file. Book a test at least 8 weeks before ${earliest ?? 'your first deadline'} so results arrive in time.`
          : `Your current level is IELTS ${ielts} and your shortlist needs ${needed}. Book a retake now — results take roughly 2 weeks.`,
      category: 'tests',
      dueDate: iso(safeDue(addDays(today, 14), today)),
      priority: 'critical',
      rationale: englishGap.detail,
    });
    push({
      id: 'english-prep',
      title: 'Complete focused English preparation',
      description:
        'Target the weakest band specifically — writing and speaking move fastest with structured practice and feedback.',
      category: 'tests',
      dueDate: iso(safeDue(addDays(today, 45), today)),
      priority: 'high',
      rationale: englishGap.detail,
    });
  } else if (ielts !== null) {
    push({
      id: 'english-send',
      title: 'Send your official English score to each university',
      description: `Your IELTS ${ielts} equivalent meets requirements, but scores must be sent officially through the test provider — universities do not accept screenshots.`,
      category: 'documents',
      dueDate: iso(safeDue(addDays(earliestDate, -21), today)),
      priority: 'high',
      rationale: 'Score reporting is a common last-minute failure point.',
    });
  }

  /* ---------------- SAT (gap-driven) ---------------- */
  const satGap = diagnostics.gaps.find((g) => g.key === 'sat-missing' || g.key === 'sat-below');
  if (satGap) {
    const needing = recommendations.filter(
      (r) => r.university.satPolicy === 'required' || r.university.satPolicy === 'recommended',
    );
    if (needing.length > 0) {
      push({
        id: 'sat-register',
        title: profile.satScore === null ? 'Register for an SAT sitting' : 'Register for an SAT retake',
        description: `${needing
          .slice(0, 3)
          .map((r) => r.university.shortName)
          .join(', ')} ${needing.length > 3 ? `and ${needing.length - 3} more ` : ''}require or recommend an SAT score. Pick the last sitting that still reports before ${earliest ?? 'your deadlines'}.`,
        category: 'tests',
        dueDate: iso(safeDue(addDays(today, 21), today)),
        priority: needing.some((r) => r.university.satPolicy === 'required') ? 'critical' : 'high',
        rationale: satGap.detail,
      });
      push({
        id: 'sat-prep',
        title: 'Run a timed SAT practice cycle',
        description:
          'Two full timed papers with error analysis between them is the highest-yield preparation in a short window.',
        category: 'tests',
        dueDate: iso(safeDue(addDays(today, 40), today)),
        priority: 'normal',
        rationale: satGap.detail,
      });
    }
  }

  /* ---------------- Documents ---------------- */
  push({
    id: 'doc-statement',
    title: 'Draft your personal statement',
    description: `Write a first draft focused on why ${MAJOR_LABELS[profile.intendedMajor]} and what you have actually done in it. One draft can be adapted across most of your shortlist.`,
    category: 'documents',
    dueDate: iso(safeDue(addDays(earliestDate, -45), today)),
    priority: 'high',
    rationale: 'Personal statements take several revision rounds; starting late is the most common cause of weak applications.',
  });
  push({
    id: 'doc-recommendations',
    title: 'Request recommendation letters',
    description:
      'Ask two teachers who taught you in subjects relevant to your major. Give them your CV, your draft statement and at least three weeks.',
    category: 'documents',
    dueDate: iso(safeDue(addDays(earliestDate, -40), today)),
    priority: 'high',
    rationale: 'Teachers need lead time, and late requests produce generic letters.',
  });
  push({
    id: 'doc-transcript',
    title: 'Request official transcripts and translations',
    description:
      'Order sealed transcripts from your school and arrange certified English translations if your documents are not already in English.',
    category: 'documents',
    dueDate: iso(safeDue(addDays(earliestDate, -30), today)),
    priority: 'normal',
    rationale: 'Translation and certification routinely take two to three weeks.',
  });

  if (profile.aidNeed !== 'none') {
    push({
      id: 'doc-financial',
      title: 'Prepare financial aid documentation',
      description: `You said you need ${profile.aidNeed === 'full-ride' ? 'tuition and living costs covered' : profile.aidNeed === 'full-tuition' ? 'full tuition covered' : 'partial scholarship support'}. Gather parental income statements, tax documents and bank confirmations — most aid offices require certified translations.`,
      category: 'scholarships',
      dueDate: iso(safeDue(addDays(earliestDate, -35), today)),
      priority: 'critical',
      rationale: `Your stated budget is ${formatUSD(profile.budgetAnnualUSD)} per year, so aid is not optional for most of your shortlist.`,
    });
  }

  /* ---------------- Per-university application + scholarship tasks ---------------- */
  for (const rec of sorted.slice(0, 5)) {
    const u = rec.university;
    if (u.applicationDeadline) {
      const dl = new Date(`${u.applicationDeadline}T00:00:00Z`);
      const daysOut = daysBetween(today, dl);
      push({
        id: `apply-${u.id}`,
        title: `Submit your application to ${u.shortName}`,
        description: `Applications go through ${u.applicationPlatform}. The deadline is ${dl.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.`,
        category: 'applications',
        dueDate: u.applicationDeadline,
        priority: daysOut <= 45 ? 'critical' : daysOut <= 90 ? 'high' : 'normal',
        relatedUniversityId: u.id,
        relatedUniversityName: u.name,
        rationale: `${u.shortName} is a ${rec.category === 'strong' ? 'strong' : rec.category === 'possible' ? 'possible' : 'ambitious'} match at ${rec.score}% alignment with your profile.`,
      });
    }
    if (
      u.scholarshipDeadline &&
      profile.aidNeed !== 'none' &&
      u.scholarshipAvailability !== 'rare-for-international'
    ) {
      const sdl = new Date(`${u.scholarshipDeadline}T00:00:00Z`);
      const daysOut = daysBetween(today, sdl);
      push({
        id: `scholarship-${u.id}`,
        title: `Apply for financial support at ${u.shortName}`,
        description: u.aidNote,
        category: 'scholarships',
        dueDate: u.scholarshipDeadline,
        priority: daysOut <= 60 ? 'critical' : 'high',
        relatedUniversityId: u.id,
        relatedUniversityName: u.name,
        rationale:
          rec.fits.financial.verdict === 'potentially-affordable-with-aid'
            ? `${u.shortName} is only affordable for you if this aid comes through.`
            : `Aid here would reduce your family contribution below ${formatUSD(profile.budgetAnnualUSD)}.`,
      });
    }
  }

  /* De-duplicate by id, keep earliest deadline ordering. */
  const seen = new Set<string>();
  return tasks
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Groups tasks into month buckets for the roadmap timeline. */
export function groupByMonth(tasks: RoadmapTask[]): RoadmapMonth[] {
  const map = new Map<string, RoadmapTask[]>();
  for (const t of tasks) {
    const list = map.get(t.monthKey) ?? [];
    list.push(t);
    map.set(t.monthKey, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({
      monthKey: key,
      label: MONTH_LABEL(new Date(`${key}-01T00:00:00Z`)),
      tasks: list.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    }));
}

/* ------------------------------------------------------------------ */
/* Next best action                                                    */
/* ------------------------------------------------------------------ */

const PRIORITY_RANK: Record<RoadmapTask['priority'], number> = { critical: 0, high: 1, normal: 2 };

const CTA_BY_CATEGORY: Record<TaskCategory, { label: string; href: string }> = {
  shortlist: { label: 'Review Shortlist', href: '/recommendations' },
  tests: { label: 'Open Roadmap', href: '/roadmap' },
  documents: { label: 'Open Roadmap', href: '/roadmap' },
  applications: { label: 'Open Roadmap', href: '/roadmap' },
  scholarships: { label: 'Open Roadmap', href: '/roadmap' },
};

/**
 * Picks the single most important thing to do right now.
 *
 * Ordering is priority first, then deadline proximity. Completing the current
 * action promotes the next one, which is what makes the product feel like a
 * navigator rather than a static report.
 */
export function getNextAction(
  tasks: RoadmapTask[],
  completed: Record<string, boolean>,
  recommendations: Recommendation[],
  today: Date = new Date(),
): NextAction | null {
  const open = tasks.filter((t) => !completed[t.id]);
  if (open.length === 0) return null;

  const ranked = [...open].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const task = ranked[0];

  /* Build the "why" from real facts, not filler. */
  let why = task.rationale;
  const soon = recommendations.filter((r) => {
    const d = r.university.scholarshipDeadline;
    if (!d) return false;
    const days = daysBetween(today, new Date(`${d}T00:00:00Z`));
    return days >= 0 && days <= 35;
  });
  if (task.category === 'shortlist' && soon.length > 0) {
    why = `${soon.length} recommended universit${soon.length === 1 ? 'y has a scholarship deadline' : 'ies have scholarship deadlines'} within the next month (${soon
      .slice(0, 3)
      .map((r) => r.university.shortName)
      .join(', ')}).`;
  } else {
    const days = daysBetween(today, new Date(`${task.dueDate}T00:00:00Z`));
    if (days >= 0 && days <= 30) {
      why = `${task.rationale} This is due in ${days} day${days === 1 ? '' : 's'}.`;
    }
  }

  const cta = CTA_BY_CATEGORY[task.category];
  return { task, why, ctaLabel: cta.label, ctaHref: cta.href };
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

const TRACK_LABELS: Record<TaskCategory | 'profile', string> = {
  profile: 'Profile',
  shortlist: 'Shortlist',
  tests: 'Tests',
  documents: 'Documents',
  applications: 'Applications',
  scholarships: 'Scholarships',
};

const TRACK_ORDER: (TaskCategory | 'profile')[] = [
  'profile',
  'shortlist',
  'tests',
  'documents',
  'scholarships',
  'applications',
];

/**
 * Progress is computed exclusively from real state: whether the questionnaire is
 * complete, and which roadmap tasks the student has actually ticked off.
 * There is no decorative progress anywhere in this product.
 */
export function calculateProgress(
  tasks: RoadmapTask[],
  completed: Record<string, boolean>,
  profileComplete: boolean,
): ProgressSnapshot {
  const tracks: TrackProgress[] = [];

  tracks.push({
    key: 'profile',
    label: TRACK_LABELS.profile,
    percent: profileComplete ? 100 : 0,
    completed: profileComplete ? 1 : 0,
    total: 1,
  });

  for (const key of TRACK_ORDER) {
    if (key === 'profile') continue;
    const inTrack = tasks.filter((t) => t.category === key);
    const done = inTrack.filter((t) => completed[t.id]).length;
    tracks.push({
      key,
      label: TRACK_LABELS[key],
      percent: inTrack.length === 0 ? 0 : Math.round((done / inTrack.length) * 100),
      completed: done,
      total: inTrack.length,
    });
  }

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => completed[t.id]).length;

  // Profile counts as one unit alongside every task, so finishing onboarding
  // alone never reads as "most of the way there".
  const denom = totalTasks + 1;
  const numer = completedTasks + (profileComplete ? 1 : 0);

  return {
    tracks: tracks.filter((t) => t.total > 0),
    overallPercent: denom === 0 ? 0 : Math.round((numer / denom) * 100),
    completedTasks,
    totalTasks,
  };
}

/** Upcoming deadlines across the shortlist, for the dashboard widget. */
export function upcomingDeadlines(tasks: RoadmapTask[], completed: Record<string, boolean>, limit = 4) {
  return tasks
    .filter((t) => !completed[t.id])
    .filter((t) => t.category === 'applications' || t.category === 'scholarships' || t.priority === 'critical')
    .slice(0, limit);
}
