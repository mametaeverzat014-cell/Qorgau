# AdmitPath AI

**From "Where can I apply?" to "What should I do next?"**

A personalized university admissions navigator built for **LOCUSCASE2 — «Маршрут поступления»**.

A student answers a five-step questionnaire once. AdmitPath then tells them where they realistically
fit, **why** each recommendation was produced, how the options differ, what is missing from their
profile, which deadlines matter, what to do next, and how much of the route they have completed.

It is not a university search engine. It is a personalized **application route**.

---

## Problem

A high-school student planning international applications faces the same wall every year:

- they do not know which universities fit their academic profile;
- they cannot tell what is financially realistic, and sticker prices are misleading;
- they do not know which scholarships actually exist for international undergraduates;
- they are weighing several countries with no way to compare them;
- they do not know whether their IELTS, SAT or GPA is sufficient;
- they lose track of deadlines spread across platforms and time zones;
- the tools they find return generic lists with no reasoning;
- and after reading one, they still do not know what to do tomorrow morning.

The core failure is that existing tools output a **list**. A list is not a plan.

## Our solution

AdmitPath converts one profile into seven connected outputs:

| Case requirement | Where it lives in the product |
| --- | --- |
| **User questionnaire** | `/onboarding` — 5 steps, stepper, validation, resume, ~2 minutes |
| **Diagnostics** | `/diagnostics` — 6 readiness dimensions + generated insights + gaps, shown *before* any list |
| **≥3 recommendations with explanations** | `/recommendations` — typically 6–8 results, each with reasons, concerns and a full-sentence rationale |
| **Comparison** | `/compare` — 2–4 universities across 15 dimensions, winning cells marked |
| **Personal roadmap** | `/roadmap` — dated tasks in month buckets, each stating why it exists |
| **Next action** | Next-best-action engine, surfaced on `/dashboard` and `/roadmap` |
| **Progress tracking** | Six tracks driven only by real task completion |
| **Country/budget sensitivity** | What-if controls on `/recommendations` with a "What changed?" diff |

## Target audience

High-school students (Grade 10–12 and recent graduates) planning international undergraduate
applications, particularly from Central Asia — where the gap between academic ability and the
information needed to act on it is widest. The dataset and demo profiles are built around that
student, but nothing in the engine is region-specific.

---

## The parameter-sensitivity requirement

The case states explicitly that changing **country** or **budget** must noticeably and logically
change the output. This is the feature we built the product around, so here is exactly what happens.

**Changing country** — the engine applies a focus multiplier (`OUT_OF_SCOPE_MULTIPLIER = 0.55`) to
any university outside the selected countries, on top of the geography component. An out-of-scope
university keeps its intrinsic fit but ranks below every comparable in-scope option. Measured on our
own demo profile:

```
Aizhan, USA + Hong Kong  ->  Berea, CUHK, HKUST, HKU, MIT, Stanford, Yale, Harvard
Aizhan, South Korea      ->  KAIST, POSTECH, SNU, SKKU, Korea University, Yonsei UIC
```

Complete turnover, and the app states it: *"6 new options entered your results … 8 options dropped
out … Your top match changed from Berea to KAIST."*

**Changing budget** — the budget control sets the annual contribution **and** the funding requirement
that logically follows from it, because a family that can pay $25,000 a year does not need a full
ride. The "What changed?" panel reports both halves:

```
Your budget changed from $5,000/year to $25,000/year.
Your funding requirement changed from full ride to partial.
  + 10 universities are now financially compatible without depending on aid
  - 10 universities above your budget even in the best aid scenario
  + CityU HK entered your results
  - Harvard dropped out
```

Nothing here is staged. Both figures come from the same deterministic engine the tests exercise.

---

## Recommendation methodology

Every university is scored on **seven independent dimensions**, each a pure function returning a
0–100 score plus structured reasons, concerns and machine-readable flags:

| Matcher | Weight | What it asks |
| --- | --- | --- |
| `calculateFinancialFit` | 24% | With what this family can pay and the aid this university actually publishes, can the student go here? |
| `calculateAcademicFit` | 18% | How does the student's normalised average compare with the typical intake, adjusted for selectivity? |
| `calculateMajorFit` | 18% | Is the intended major offered, adjacent, or absent? |
| `calculateGeographicFit` | 13% | Country, region, city size, campus environment, language of instruction. |
| `calculateScholarshipFit` | 10% | Does this university offer the *kind* of support the student said they need? |
| `calculateTestFit` | 8% | English against the published requirement; SAT against the university's actual policy. |
| `calculatePreferenceFit` | 9% | Research intensity, reputation and size against the student's own sliders. |

Weights live in `src/lib/weights.ts` and nowhere else.

**Match score is not admission probability.** We do not model admission chances and we say so on the
recommendations screen, on every card tooltip, in the comparison table, on every detail page and in
the footer of every screen. A test asserts that no generated string anywhere in the product claims
one.

### Three decisions worth defending

**1. Financial fit is deliberately pessimistic.** We compute a best-case net cost from published aid
policy — full-ride providers reach $0, full-tuition providers still owe living costs, and everything
else keeps a conservative fraction of sticker price (`BEST_CASE_NET_COST_FACTOR`). A university is
only *Strong Financial Fit* when the sticker cost is already within reach; when it depends on winning
aid it is labelled **"Affordable only with aid"** and the card says so in words. A $5,000 budget never
silently matches an $80,000 university.

**2. A missing SAT is unknown, never zero.** Scoring it as zero would be the single most damaging
modelling error in this domain. `calculateTestFit` branches on the university's actual policy: a
missing SAT is near-neutral where the test is optional or unused, a moderate unknown where it is
recommended, and a blocking gap only where it is required.

**3. Match categories describe alignment, not odds.** *Strong Match* additionally requires an academic
component ≥ 55, so a cheap nearby university is never called a strong match for a student whose
record is far below its intake.

---

## Architecture

```
UI  (Next.js App Router pages + components)
 |
Profile State  (React context -> localStorage, never a server)
 |
Recommendation Engine   [pure, deterministic, synchronous, no network]
 |- Academic Matcher        calculateAcademicFit()
 |- Financial Matcher       calculateFinancialFit()
 |- Major Matcher           calculateMajorFit()
 |- Geography Matcher       calculateGeographicFit()
 |- Requirement Matcher     calculateTestFit()
 |- Scholarship Matcher     calculateScholarshipFit()
 `- Preference Matcher      calculatePreferenceFit()
 |
Ranked Recommendations   (score + 7 components + reasons + concerns)
 |
Explanation Engine  ->  Diagnostics Engine
 |                          |
 |                      Profile Gaps
 |                          |
 |-> Comparison Engine       `-> Roadmap Engine -> Next-Best-Action
 |                                     |
 `-> What-if Diff Engine                `-> Progress State -> localStorage
 |
[optional] AIExplanationProvider  -- rephrases only; never consulted for a decision
```

```
src/
  app/            routes: /, /onboarding, /diagnostics, /recommendations,
                  /university/[id], /compare, /roadmap, /dashboard, /api/explain
  components/     ui primitives, onboarding fields, recommendation cards,
                  what-if controls, route (next action / progress / tasks)
  lib/
    types.ts      the whole domain model
    weights.ts    all scoring configuration in one file
    store.tsx     profile + task state, localStorage-backed
    demo.ts       three bundled demo students
    engine/       matchers, score, explain, diagnostics, roadmap, compare, whatif
    ai/           AIExplanationProvider abstraction
  data/
    universities.ts   35 curated institutions, every record source-linked
tests/            62 tests over the engine and the product guarantees
```

No component exceeds a few hundred lines, and no React file contains scoring logic.

---

## Data sources

We did **not** build a worldwide university database in 72 hours, and the product does not claim to
have one. `src/data/universities.ts` holds **35 hand-curated institutions across 15 countries and 6
regions**, chosen to exercise every branch of the engine: need-blind full-need US privates, no-tuition
models, low-cost European public systems, Asian scholarship-dense universities, and sticker-price
privates with little international aid.

**Every record carries three official source links** — admissions, tuition, and scholarships — exposed
in the UI as "View official source" on each university's detail page.

Source types used, in order of preference:

1. official university admissions pages;
2. official tuition and fees pages;
3. official scholarship and financial-aid pages.

No aggregators are used where an official source exists.

### Data honesty policy

This matters more than dataset size, so it is enforced in the type system:

- Every monetary value is a `Money` object carrying an explicit `confidence` field.
- **All cost figures are marked `estimate`** and are labelled **"Estimate"** in the UI. They are our
  indicative compilation for the 2026–27 cycle, not quotations from the institutions. Costs vary by
  programme, citizenship and year.
- **Requirements and aid policies are marked `published`** and labelled **"Published"**, reflecting
  stated institutional policy, with the source link beside them.
- Where a value could not be verified we store `null` with `confidence: 'unknown'` and the UI prints
  **"Unverified"** rather than a number. A test asserts that an `unknown` confidence always pairs with
  a `null` value.
- Deadlines are the typical international undergraduate dates for this cycle and are shown with an
  explicit "confirm at source" note.

**A student must confirm every figure and deadline at the linked official source before acting on
it.** The app repeats this in the footer of every screen.

---

## AI and APIs used

| Component | AI involvement |
| --- | --- |
| Recommendation engine | **None.** Pure deterministic TypeScript. |
| Diagnostics, gaps, insights | **None.** Derived from profile + ranked results. |
| Comparison | **None.** |
| Roadmap, next action, progress | **None.** |
| Explanation text on cards and detail pages | **None** by default — written by the deterministic explanation engine. |
| "Rephrase with AI" button on detail pages | **Optional.** Anthropic Messages API, if a key is configured. |

The optional layer sits behind `AIExplanationProvider` (`src/lib/ai/provider.ts`) and is called only
from a button the student presses. It may **rephrase text the engine already produced** — it is
forbidden by prompt from introducing facts, changing a recommendation, or implying admission odds.

If the key is absent, the request fails, the network is down, the response is malformed, or it times
out, the student sees the deterministic explanation and a note explaining why. Four tests cover those
failure paths. **The API key is read only inside the server route `src/app/api/explain/route.ts` and
is never shipped to the browser.** See `.env.example`.

## Ready-made components used

Disclosed in full:

- **Next.js 15** (App Router) — framework
- **React 19** — UI runtime
- **Tailwind CSS v4** — styling; the design tokens and every component are ours
- **lucide-react** — icon set
- **Vitest** — test runner
- **Playwright** — used during development for browser verification only; not a runtime dependency

No UI component library, no admin template, no dashboard kit. Every screen, component, animation and
token in this repository was written for this project. The recommendation engine, dataset, diagnostics,
roadmap, comparison and what-if logic are entirely our own.

---

## Limitations

We would rather state these than have a judge find them:

1. **35 universities, not 30,000.** A real student needs far more. The engine is dataset-agnostic — it
   scores whatever is in `universities.ts` — but coverage is a genuine limitation today.
2. **Cost figures are estimates.** They are labelled as such everywhere and must be verified at source.
3. **Deadlines shift year to year.** Ours are typical for this cycle, not a live feed.
4. **No admission probability.** Deliberate. Modelling it honestly needs admissions outcome data we do
   not have, and guessing would be the most harmful thing this product could do.
5. **Aid is modelled from published policy, not from individual circumstances.** Real awards depend on
   documents, timing and competition. "Affordable only with aid" means exactly that: conditional.
6. **`localStorage` only.** No account, no sync, no cross-device. Clearing browser data clears the
   profile — which is also why "Clear my data" is one click away.
7. **Not enterprise security.** There is no server-side storage of personal data at all, which is the
   honest mitigation, but we make no security claims beyond that.
8. **English-language interface only.**

---

## Local development

Requires Node.js 20 or newer.

```bash
git clone https://github.com/mametaeverzat014-cell/qorgau.git
cd qorgau
npm install

npm run dev        # http://localhost:3000
```

Verification:

```bash
npm run typecheck  # tsc --noEmit, strict mode
npm run test       # 62 Vitest tests
npm run build      # production build
npm run verify     # all three in sequence
```

Optional AI layer:

```bash
cp .env.example .env.local
# add ANTHROPIC_API_KEY=... ; the app is fully functional without it
```

## Deployment

The app is a standard Next.js application with **no database, no auth provider and no required
environment variables**, so deployment is zero-config.

Import the repository at [vercel.com/new](https://vercel.com/new) and accept every default — the
framework is auto-detected and the repository's default branch is already the branch that holds the
code. If the repository is not listed, click *Adjust GitHub App Permissions* and grant Vercel access
to it.

Or from the CLI:

```bash
npm i -g vercel
vercel login
vercel --prod
```

`ANTHROPIC_API_KEY` is optional. Set it in Settings → Environment Variables only if you want the
"Rephrase with AI" button live; everything else works without it.

Verified deployment-readiness (see `FINAL_AUDIT.md`): a clean clone installs, type-checks, passes 62
tests and builds; all 35 university pages pre-render; the production server handles unknown ids and
nonsense routes without falling over.

---

## Test scenario for judges

**This exact sequence takes about 90 seconds and exercises every case requirement.**

1. Open the deployed site. Click **Try Demo Profile** → **Aizhan — high achiever, needs a full ride**.
2. **Diagnostics** appears before any university list. Note *Financial Flexibility: Limited*,
   *Scholarship Dependence: Very high* — both derived from her answers — and the gaps beneath.
3. Click **See recommendations**. Eight universities, each with *Why it matches you* and *Watch out*.
   Note Berea College at the top: a no-tuition institution, surfaced because she needs full-cost aid.
4. In **What-if controls**, change the budget from **$5,000** to **$25,000**.
   → The **"What changed?"** panel reports the budget change, the funding-requirement change,
   *+10 universities now financially compatible*, CityU HK entering and Harvard dropping out.
5. Now change the destination: deselect **USA** and **Hong Kong**, select **South Korea**.
   → The entire list turns over. Top match moves from Berea College to KAIST. The panel names every
   university that entered and left.
6. Click **Reset**, then **Compare** on three universities → open **Compare**.
   → 15 dimensions, winning cells marked green, and a row showing where each option *wins and loses
   relative to the others selected*.
7. Open **Roadmap**. ~20 dated tasks across September 2026 → March 2027, each with
   *"Generated because: …"*.
8. Click **Mark complete** on **Your next step**.
   → Progress moves (5% → 10%), the Shortlist track advances, and the next step changes to
   *Prepare financial aid documentation* with a new reason.
9. Open **Dashboard** to see all of it in one view.

To check we are not hiding behind the demo: click **Edit profile**, change the intended major or the
budget, and watch the diagnostics, recommendations, roadmap and next action all regenerate.

---

## Team

| Role | Member |
| --- | --- |
| Product & case strategy | *(team member)* |
| Full-stack engineering | *(team member)* |
| Recommendation engine & data curation | *(team member)* |
| UX / UI design | *(team member)* |

Placeholders — to be filled in with real names before submission.

## Hackathon development

The primary implementation of this project was created during the hackathon period. Commit history is
genuine and unmodified: no timestamps were faked and no history was rewritten. The repository begins
from an empty state and progresses through the milestones visible in `git log`.

---

## Licence and disclaimer

Built for LOCUSCASE2. AdmitPath is a **decision-support tool, not an admissions authority**. Match
scores describe alignment with a stated profile and are never a prediction of admission. Costs are
indicative estimates. Always confirm figures, requirements and deadlines with the university before
acting on them.
