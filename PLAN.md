# AdmitPath AI — Implementation Plan (LOCUSCASE2)

**Deadline:** 19 Sep 2026, 12:00 Astana
**One-line:** From "Where can I apply?" to "What should I do next?"

## Phase 1 — Repository audit (done)

| Item | Finding |
| --- | --- |
| Files | Empty repository — only `.git`, zero commits |
| Framework | None |
| Existing functionality | None |
| Obvious issues | Nothing to migrate; full greenfield build, so all time goes to the product |

Decision: greenfield **Next.js 15 (App Router) + TypeScript + Tailwind CSS v4**, client-side state in
`localStorage`, no database, no auth, no backend service. Deployment target: Vercel.

## Architecture

```
UI (App Router pages + components)
        |
Profile State (React context -> localStorage)
        |
Recommendation Engine  (pure, deterministic, synchronous)
  |- Academic Matcher       calculateAcademicFit()
  |- Financial Matcher      calculateFinancialFit()
  |- Major Matcher          calculateMajorFit()
  |- Geography Matcher      calculateGeographicFit()
  |- Requirement Matcher    calculateTestFit()
  |- Scholarship Matcher    calculateScholarshipFit()
  `- Preference Matcher     calculatePreferenceFit()
        |
Ranked Recommendations (score + components + reasons + concerns)
        |
Explanation Engine -> Diagnostics / Comparison / Roadmap engines
        |
Progress State (task completion -> localStorage)
```

Hard rule: the engine is a set of **pure functions** in `src/lib/engine/*`, unit-tested, with no React
and no network. The optional AI layer only rephrases text that already exists.

## Task breakdown

### P0 — must work
- [x] Project bootstrap (Next 15, TS strict, Tailwind v4, Vitest)
- [x] Domain types + scoring weight configuration (`src/lib/types.ts`, `src/lib/weights.ts`)
- [x] Curated university dataset, 34 institutions, 6 regions, every record source-linked
- [x] Multi-step onboarding questionnaire (5 steps + stepper + validation + resume)
- [x] Recommendation engine (7 matchers + weighted overall + reasons/concerns)
- [x] Diagnostics screen (6 readiness dimensions + generated insights)
- [x] Recommendation list with personalized explanations, >= 3 (typically 6-8) results
- [x] Budget sensitivity + Country sensitivity what-if controls with "What changed" diff
- [x] Comparison view (2-4 universities, 13 dimensions, difference highlighting)
- [x] Personalized roadmap generated from profile gaps + real deadlines
- [x] Next Best Action engine
- [x] Progress tracking across 5 tracks driven by real task completion
- [x] Dashboard tying all of it together
- [x] Deployment-ready build (`npm run build` clean)

### P1 — must look great
- [x] Design system: light premium palette, large type, subtle borders, motion tokens
- [x] 3 bundled demo profiles + one-click load
- [x] University detail page with sources + known-vs-estimated data separation
- [x] Empty / loading / error / no-results states with explanations
- [x] Responsive (mobile through projector), sticky nav, keyboard-reachable controls
- [x] Source links surfaced throughout ("View official source")

### P2 — only after P0/P1
- [x] Optional AI explanation layer behind `AIExplanationProvider` with deterministic fallback
- [x] Micro-transitions on step change and re-ranking

## Testing (Vitest, `tests/`)
1. Lower budget changes financial ranking
2. Changing preferred country materially changes recommendations
3. Matching major ranks above non-matching major, all else equal
4. IELTS below requirement raises a warning
5. Missing SAT is not treated as SAT = 0
6. Full-scholarship requirement penalizes universities without relevant aid
7. Demo profiles each return >= 3 institutions
8. Every recommendation carries reasons
9. Roadmap responds to profile gaps
10. Progress changes when tasks are completed

## Non-goals (explicitly not built)
Auth, payments, admin panel, chat, microservices, scraped global university database,
fake ML model, fake admission probabilities, fake partnerships or user counts.

## Commit milestones
bootstrap -> dataset -> engine -> onboarding -> recommendations UI -> what-if ->
comparison -> roadmap/progress -> dashboard -> tests -> polish -> submission docs
