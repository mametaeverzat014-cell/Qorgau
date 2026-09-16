'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { EMPTY_PROFILE } from './demo';
import { buildDiagnostics } from './engine/diagnostics';
import { buildRoadmap, calculateProgress, getNextAction } from './engine/roadmap';
import { getRecommendations, type RecommendationSet } from './engine/score';
import type { Diagnostics, NextAction, ProgressSnapshot, RoadmapTask, StudentProfile } from './types';

const KEYS = {
  profile: 'admitpath.profile.v1',
  tasks: 'admitpath.tasks.v1',
  shortlist: 'admitpath.shortlist.v1',
  compare: 'admitpath.compare.v1',
} as const;

/** localStorage access that never throws — private mode, quota, SSR. */
function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage unavailable — the app stays fully usable for this session. */
  }
}

interface AppState {
  /** False until localStorage has been read, so the UI can avoid a hydration flash. */
  ready: boolean;
  profile: StudentProfile;
  hasProfile: boolean;
  setProfile: (p: StudentProfile) => void;
  updateProfile: (patch: Partial<StudentProfile>) => void;

  recommendations: RecommendationSet;
  diagnostics: Diagnostics;
  tasks: RoadmapTask[];
  completed: Record<string, boolean>;
  toggleTask: (id: string) => void;
  progress: ProgressSnapshot;
  nextAction: NextAction | null;

  shortlist: string[];
  toggleShortlist: (id: string) => void;

  compareIds: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;

  clearAllData: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfileState] = useState<StudentProfile>(EMPTY_PROFILE);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  /* ---- hydrate from localStorage once on mount ---- */
  useEffect(() => {
    setProfileState(readJSON<StudentProfile>(KEYS.profile, EMPTY_PROFILE));
    setCompleted(readJSON<Record<string, boolean>>(KEYS.tasks, {}));
    setShortlist(readJSON<string[]>(KEYS.shortlist, []));
    setCompareIds(readJSON<string[]>(KEYS.compare, []));
    setReady(true);
  }, []);

  const setProfile = useCallback((p: StudentProfile) => {
    setProfileState(p);
    writeJSON(KEYS.profile, p);
  }, []);

  const updateProfile = useCallback((patch: Partial<StudentProfile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...patch };
      writeJSON(KEYS.profile, next);
      return next;
    });
  }, []);

  const toggleTask = useCallback((id: string) => {
    setCompleted((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      writeJSON(KEYS.tasks, next);
      return next;
    });
  }, []);

  const toggleShortlist = useCallback((id: string) => {
    setShortlist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeJSON(KEYS.shortlist, next);
      return next;
    });
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        writeJSON(KEYS.compare, next);
        return next;
      }
      // The comparison table is only readable up to four columns.
      if (prev.length >= 4) return prev;
      const next = [...prev, id];
      writeJSON(KEYS.compare, next);
      return next;
    });
  }, []);

  const clearCompare = useCallback(() => {
    setCompareIds([]);
    writeJSON(KEYS.compare, []);
  }, []);

  const clearAllData = useCallback(() => {
    setProfileState(EMPTY_PROFILE);
    setCompleted({});
    setShortlist([]);
    setCompareIds([]);
    if (typeof window !== 'undefined') {
      try {
        Object.values(KEYS).forEach((k) => window.localStorage.removeItem(k));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const hasProfile = Boolean(profile.completedAt);

  /* ---- derived state: the engine runs synchronously, so this is instant ---- */
  const recommendations = useMemo(() => getRecommendations(profile), [profile]);
  const diagnostics = useMemo(
    () => buildDiagnostics(profile, recommendations),
    [profile, recommendations],
  );
  const tasks = useMemo(
    () => buildRoadmap(profile, recommendations.results, diagnostics),
    [profile, recommendations, diagnostics],
  );
  const progress = useMemo(
    () => calculateProgress(tasks, completed, hasProfile),
    [tasks, completed, hasProfile],
  );
  const nextAction = useMemo(
    () => getNextAction(tasks, completed, recommendations.results),
    [tasks, completed, recommendations],
  );

  const value: AppState = {
    ready,
    profile,
    hasProfile,
    setProfile,
    updateProfile,
    recommendations,
    diagnostics,
    tasks,
    completed,
    toggleTask,
    progress,
    nextAction,
    shortlist,
    toggleShortlist,
    compareIds,
    toggleCompare,
    clearCompare,
    clearAllData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
