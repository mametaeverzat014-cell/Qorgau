# AdmitPath AI — realistic scorecard against the official rubric

Scored against the **LOCUS Startup Hackathon 2026** preliminary rubric. Every figure was measured
during the audit in `95PLUS_AUDIT.md`, not estimated. Where a weakness remains it is named, including
the one that stops this being a 100.

**Realistic total: 93–96 / 100.**

---

## 1. Accuracy and Verifiability — **23–24 / 25**

*Correctness of results · reliability of data · transparency of sources · ability to verify claims*

**Evidence**

- **No "Published" badge exists**, deliberately. The three states are Curated (compiled from public
  materials at curation time), Estimate (our own figure, quoted from nobody) and Unverified (`null`,
  shown as nothing). Every record carries `provenance` with `compiledOn`, surfaced as *"Record last
  reviewed …"*.
- **Aid reliability is modelled, not assumed.** `aidCertainty` separates institutions that meet full
  demonstrated need from those awarding a handful of competitive scholarships. At a $5,000 budget
  Harvard scores **59** and TU Delft **40** despite $91,000 vs $37,000 stickers — the correct ordering,
  which a single `fullRidePossible` flag got backwards.
- **Claims are checkable by hand:** components × weights reconstruct every headline score to within a
  rounding point (tested), and the seven scores are on every card.
- **No admission probability anywhere.** A test scans every generated string across all demo profiles
  and finds none.
- **17 dataset QA tests** guard nulls-not-coerced-to-zero, no negative or implausible money, score
  ranges, deadlines inside the cycle and aid-claim consistency. They caught a real defect during this
  audit (TU Delft claiming a full ride while denying full tuition).
- `npm run check:links` HTTP-checks every source URL.

**Remaining weakness**

Nothing has been verified against live institutional pages, because the build environment blocks all
outbound traffic (confirmed: `www.google.com`, `www.hku.hk`, `mitadmissions.org` all rejected by
egress policy). The product is honest about this everywhere, which is the right mitigation — but a
judge who spot-checks a specific IELTS minimum may still find a stale value.

**Why not 25:** verified-at-source data would be required, and we cannot produce it from here.

---

## 2. Case Compliance and Usefulness — **19 / 20**

*How completely the case is solved · how useful the result is*

**Evidence** — every required stage implemented and measured end to end:

| Requirement | Status |
| --- | --- |
| Questionnaire | 5 steps, validated, resumable, completed by hand in the browser audit |
| Diagnostics | 6 dimensions + insights + gaps, verified to appear with **0 ranked cards** before it |
| ≥3 recommendations | 6–8 returned (Aizhan 8, Daniyar 6, Madina 8) |
| Explanations | 8/8 cards carry reasons, concerns and a collapsible seven-score breakdown |
| Comparison | 15 dimensions, winning cells marked, relative win/lose per column |
| Roadmap | ~20 dated tasks across 5 months, each stating why it exists |
| Next action | Advances on completion, with a recomputed reason |
| Progress | 6 tracks, moves only on real completion, reversible |
| Country sensitivity | USA→South Korea leaves ≤1 survivor; top 3 always in the chosen country |
| Budget sensitivity | Monotonic; whole shortlist flips to unconditional affordability at no limit |

**Remaining weakness**

Dataset depth limits usefulness for a real student: 9 countries hold exactly one university, and only
one institution is classed "accessible", so a weak academic profile has few realistic safety options.
Mitigated by showing the per-country count on every chip, but not solved.

---

## 3. Functionality and Stability — **19–20 / 20**

*Core scenario works · no critical bugs · complete and stable*

**Evidence**

- **0 of 10 corrupt-storage cases crash the app**, down from **7 of 8** at audit start. Backed by 23
  unit tests covering NaN, Infinity, unknown enums, prototype pollution and 10KB strings.
- **11/12 hostile-state scenarios pass**; the twelfth was the comparison cap behaving correctly, which
  surfaced a dead button now fixed.
- **64/64 viewport/route combinations** clean from 320px to 1920px.
- Error routes verified: unknown university id → graceful empty state with the server still up;
  nonsense route → styled 404; `/api/explain` without a key → HTTP 200 with the deterministic
  fallback; malformed body → HTTP 400, never a 500.
- Global error boundary offers "Try again" and "Reset my data" instead of a white screen.
- **No uncaught JavaScript errors** in any sweep.

**Remaining weakness**

Verification is automated-browser and manual, not a persistent CI pipeline — a regression could reach
`main` without the suite running.

---

## 4. Technical Implementation — **14 / 15**

*Architecture · code quality · stack justification · integrations · AI components*

**Evidence**

- Clean separation: `src/lib/engine/` holds seven pure matchers plus scoring, explanation,
  diagnostics, roadmap, comparison and what-if engines. No React, no network, no scoring logic in any
  component.
- All weights in one file (`src/lib/weights.ts`); nothing hidden.
- Determinism is a deliberate architectural decision, documented: the same profile always yields the
  same ranking, it runs offline, and it is auditable. A model output cannot answer *"why this one and
  not that one?"*.
- The AI layer sits behind `AIExplanationProvider`, is only reachable from a button, may only rephrase
  what the engine already produced, and is proven to fall back on four distinct failure paths. The key
  is read only server-side.
- 272 tests across seven purpose-separated suites. TypeScript strict. Zero-config deployment, no
  database, no auth.

**Remaining weakness**

`universities.ts` is a single large data module, and the onboarding page is a long component. Both are
readable and deliberate, but a reviewer could reasonably want the dataset split per region.

---

## 5. UX and Clarity — **9–10 / 10**

*Interface logic · navigation · readability · speed of understanding*

**Evidence**

- Landing page answers what/who/what-you-get/what-to-click above the fold, with a six-item outcome
  preview.
- Progressive disclosure throughout: the seven-score breakdown is collapsed, provenance sits in badges
  and tooltips, the roadmap filters.
- Every screen has one obvious next action; deep links without a profile redirect to onboarding.
- Accessibility clean on 7 routes: no unnamed controls, no unlabelled inputs, one `h1` per page, no
  invalid nesting, no duplicate ids, 40/40 tab stops with visible focus. Status is never colour-only.
- Dataset limits are shown, not hidden — country chips carry their university count.

**Remaining weakness**

Recommendation cards carry a lot at once (category, rank, score ring, four facts, reasons, concerns,
breakdown toggle, two actions). It is organised and tested at 320px, but it is dense.

---

## 6. Originality and Development Potential — **9 / 10**

*Difference from obvious solutions · scalability · future application*

**Evidence**

- Positioning is a **decision engine, not a directory**: the differentiator is counterfactual
  exploration — what happens to your route when your real constraints change — plus an explanation of
  what changed and why.
- Three things most entrants would ship and we deliberately did not: an invented admission percentage,
  a scraped database presented as verified, and an LLM deciding the ranking.
- Credible scaling path documented: curated dataset → verified ingestion with per-field verification
  timestamps → versioned cycle snapshots → the same deterministic engine. `check:links` is the first
  piece and already exists.

**Remaining weakness**

"University recommender" is a crowded space, and the genuinely novel part — constraint-aware
counterfactuals with provenance — is only visible once you interact with the what-if controls.

---

## Total

| Category | Score | Max |
| --- | --- | --- |
| Accuracy and Verifiability | 23–24 | 25 |
| Case Compliance and Usefulness | 19 | 20 |
| Functionality and Stability | 19–20 | 20 |
| Technical Implementation | 14 | 15 |
| UX and Clarity | 9–10 | 10 |
| Originality and Development Potential | 9 | 10 |
| **Total** | **93–96** | **100** |

Tie-breakers are Accuracy, then Stability, then Technical Implementation — the three this audit
invested in most heavily, in that order.

---

## What still prevents a certain 95+

Exactly two things, both honest:

1. **No source-verified data.** The environment blocks outbound traffic, so no value has been checked
   against a live institutional page. Running `npm run check:links` from a normal machine, then
   spot-verifying ten IELTS minimums and ten tuition figures against the official sites and promoting
   those fields from Curated to a verified status, would close most of the gap in the
   highest-weighted, first-tie-break category.
2. **35 universities.** It costs a point on usefulness and a fraction on budget sensitivity inside
   thin country scopes. Adding 10–15 **verified** institutions — prioritising accessible-selectivity
   options, sub-$15k total cost, and medicine/law/design — would lift categories 1 and 2 together.

Both are data-collection work requiring internet access, not engineering. Neither can be honestly
faked from here, and attempting to would cost more in the first category than it gained anywhere else.
