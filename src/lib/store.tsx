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
import {
  STORAGE_KEYS,
  clearAllStoredData,
  ensureStorageVersion,
  readCompare,
  readProfile,
  readShortlist,
  readTaskMap,
  sanitizeProfile,
  write,
} from './storage';
import { buildDiagnostics } from './engine/diagnostics';
import { buildRoadmap, calculateProgress, getNextAction } from './engine/roadmap';
import { getRecommendations, type RecommendationSet } from './engine/score';
import type { Diagnostics, NextAction, ProgressSnapshot, RoadmapTask, StudentProfile } from './types';

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
    // Drop anything written by an incompatible earlier build first, then read
    // through validators so corrupt storage can never reach the engine.
    ensureStorageVersion();
    setProfileState(readProfile());
    setCompleted(readTaskMap());
    setShortlist(readShortlist());
    setCompareIds(readCompare());
    setReady(true);
  }, []);

  const setProfile = useCallback((p: StudentProfile) => {
    const safe = sanitizeProfile(p);
    setProfileState(safe);
    write(STORAGE_KEYS.profile, safe);
  }, []);

  const updateProfile = useCallback((patch: Partial<StudentProfile>) => {
    setProfileState((prev) => {
      const next = { ...prev, ...patch };
      write(STORAGE_KEYS.profile, next);
      return next;
    });
  }, []);

  const toggleTask = useCallback((id: string) => {
    setCompleted((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      write(STORAGE_KEYS.tasks, next);
      return next;
    });
  }, []);

  const toggleShortlist = useCallback((id: string) => {
    setShortlist((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      write(STORAGE_KEYS.shortlist, next);
      return next;
    });
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        write(STORAGE_KEYS.compare, next);
        return next;
      }
      // The comparison table is only readable up to four columns.
      if (prev.length >= 4) return prev;
      const next = [...prev, id];
      write(STORAGE_KEYS.compare, next);
      return next;
    });
  }, []);

  const clearCompare = useCallback(() => {
    setCompareIds([]);
    write(STORAGE_KEYS.compare, []);
  }, []);

  const clearAllData = useCallback(() => {
    setProfileState(EMPTY_PROFILE);
    setCompleted({});
    setShortlist([]);
    setCompareIds([]);
    clearAllStoredData();
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
