# AdmitPath AI — judge-oriented audit

Audit performed against the **LOCUS Startup Hackathon 2026** preliminary rubric, by re-running every
check rather than trusting prior claims. Every number below was measured during this audit.

**Baseline on entry:** typecheck clean, 66 unit tests passing, production build clean, one ESLint
warning. All verified, not assumed.

**State on exit:** typecheck clean, **124 unit tests**, production build clean, **64/64 responsive
combinations**, **0/10 corrupt-storage crashes** (was 7/8 crashing), accessibility clean on 7 routes.

---

## What this audit changed, in priority order

### P0 — Accuracy & Verifiability (25 pts, first tie-breaker)

**1. Aid reliability was not modelled at all.** `fullRidePossible` was set on 20 of 35 institutions
(57%), driving best-case net cost to `$0`. A student with a $5,000 budget was shown "$0" for Stanford
as flatly as for a genuinely free university.

The flag conflated two unrelated propositions: *"we meet the full demonstrated need of every admitted
international"* and *"a handful of competitive scholarships exist each year"*. For a high-need student
that difference decides everything.

Added an explicit `AidCertainty` axis — `meets-full-need`, `structural`, `competitive`, `minimal` —
and split the aid verdict into `potentially-affordable-with-aid` (dependable) and `aid-dependent`
(a contest you must win, scored materially lower and labelled as a long shot).

*Measured effect at a $5,000 budget:* Harvard scores **59**, TU Delft **40**, despite stickers of
$91,000 and $37,000. That inversion is correct and the previous model had it backwards. The verdict
spread went from 2 / 18 / 15 to 2 / 8 / 10 / 15.

**2. The UI asserted "Published" for data nothing verified.** English minimums, SAT policy and
application platform carried `confidence="published"` with the tooltip *"Stated by the institution on
its official pages"*. Those values were written from memory — exactly like the source URLs that turned
out to 404 in production. A judge can disprove a false Published badge in thirty seconds, in the
highest-weighted category.

Removed `published` from the vocabulary entirely. The three honest states are **Curated** (compiled
from public materials at curation time, not re-verified), **Estimate** (AdmitPath's own figure, quoted
from nobody) and **Unverified** (value is null). Added a per-institution provenance record with
`compiledOn`, and the detail page now shows a provenance legend and *"Record last reviewed …"*.

**3. Added `tests/dataset.test.ts` (17 tests).** Unique resolvable ids, no duplicate institutions,
required fields, known majors only, provenance completeness, unverified values staying null rather
than collapsing to zero, deliberate zeroes carrying an explanation, no negative or implausible money,
IELTS/TOEFL/SAT/GPA inside real ranges, minimums never exceeding their own recommended thresholds,
deadlines inside this admissions cycle, and internal consistency of aid claims.

It earned its place immediately: **TU Delft claimed a full ride while denying full tuition**, which
cannot both be true of the van Effen scholarship. Fixed the data, not the test.

### P0 — Functionality & Stability (20 pts, second tie-breaker)

**4. Corrupt localStorage crashed the app in 7 of 8 cases.** The reader caught invalid JSON but never
validated shape, so valid JSON of the wrong type went straight into React state. A profile stored as
`null`, a profile missing `preferredCountries`, a compare list stored as an object — each produced an
uncaught `TypeError` on render.

Added `src/lib/storage.ts` with field-by-field validators, a storage version that discards
incompatible state, and `src/app/error.tsx` as a recovery screen. Two stored invariants are now
repaired rather than trusted: the affordability ceiling can never sit below the comfortable budget,
and "open to anywhere" is true exactly when no country is selected.

*Measured effect:* **0 of 10** corruption cases break the app, down from 7 of 8. Backed by
`tests/storage.test.ts` (23 tests) including NaN, Infinity, unknown enums, prototype pollution and
10KB strings — each case must be both well-shaped and still scoreable.

**5. Hostile-state sweep, 12 scenarios.** Empty profile on six protected routes, partial profile
mid-onboarding, refresh on every page, browser back through the journey, comparison at 0/1/4/overflow,
task completion and un-completion, re-running onboarding over an existing profile, impossible filter
combinations, all three demo profiles, clearing data then deep-linking, localStorage disabled
entirely, unknown ids and nonsense routes. **11/12 passed on the first run**; the twelfth was the
comparison cap working as designed, which exposed a dead button (below).

### P1 — Scoring transparency and UX

**6. A dead control.** At four selections the Compare button greyed out with its reason only in a
native tooltip. Cards now read **"Compare full"** and the results page explains the cap with actions
to clear or open the comparison.

**7. Scoring transparency moved to where ranking is questioned.** The seven component scores were only
on the detail page. Every card now carries a collapsed *"Why NN%? See the seven scores"* panel showing
each dimension, its fixed weight and its score, with the alignment disclaimer inline.

**8. Dataset depth made visible.** Every country chip in the what-if control shows how many curated
universities it holds (USA 10, South Korea 6, Germany 1). Scoping to a country with fewer than three
explains that the search was widened. This converts our main limitation into information the student
can act on.

### P1 — Sensitivity proof

**9. Added `tests/sensitivity.test.ts` (17 tests).** Asserting `before !== after` would pass on a
single reordered pair, so each test asserts a specific consequence: financial score is **monotonic in
budget** (more money can never make a university look worse — the property that makes the control
trustworthy), every university moves toward affordability, the shortlist flips to unconditional
affordability at no limit, the aid-dependent share shrinks, the top three for a chosen country are all
in it, USA→South Korea leaves at most one survivor, out-of-scope options rank below the best in-scope
one, programme availability shifts with destination, both changes are explained with named
universities, and — importantly — **components × weights reconstruct the headline score to within a
rounding point**, which is what makes the ranking auditable rather than merely deterministic.

### P2 — Responsive and accessibility

**10. Fixed a 320px overflow** on the university detail page: long `whitespace-nowrap` button labels
set a min-width the card could not shrink below. Now clean across **64 viewport/route combinations**
from 320px to 1920px.

**11. Accessibility verified clean** on seven routes: no unnamed controls, no unlabelled inputs,
exactly one `h1` per page, no invalid `<p>` nesting, no duplicate ids, and 40/40 tab stops carrying a
visible focus indicator. Status is never communicated by colour alone — every badge carries text.

---

## Dataset coverage analysis

Run before considering additions, as the brief requires.

| Dimension | Finding |
| --- | --- |
| Countries | 15, but **9 hold exactly one university** (Japan, Germany, Austria, Czechia, Poland, UK, France, UAE, Kazakhstan) |
| Regions | East Asia 11, North America 10, Europe 10, Southeast Asia 2, Middle East 1, Central Asia 1 |
| Thinnest majors | Medicine 7, Law 8, Design & Architecture 8, Environmental Science 8 |
| Broadest majors | Computer Science 29, Economics 25, Engineering 23 |
| Aid certainty | competitive 16, minimal 9, meets-full-need 6, structural 4 |
| Selectivity | selective 18, highly-selective 11, moderate 5, **accessible 1** |
| Cost bands | <$5k: 2, $5–15k: 4, $15–30k: 9, $30–50k: 11, $50k+: 9 |

### Decision: no universities were added

The brief permits 5–15 additions but conditions them on *"official data can be verified"*. **This
environment has no outbound network** — verified directly: `www.google.com`, `www.hku.hk`,
`mitadmissions.org` and `admissions.illinois.edu` all fail with `connect_rejected` under an
organisation egress policy.

Writing eight new records from memory is precisely the process that produced the source URLs which
404'd in production. Trading the highest-weighted scoring category for apparent breadth is a bad deal,
so coverage was made **transparent** instead of larger. The engine is dataset-agnostic; this is a
data-collection problem, not an architectural one.

---

## Remaining weaknesses

Stated plainly, because a judge will find them.

1. **35 universities.** The binding limitation. It costs a point on budget sensitivity: scoped to a
   country where we curate ten, a budget change reorders the list and flips every affordability
   verdict but may not change *which* eight appear. The "What changed?" panel still reports the real
   effects, so the student is never misled.
2. **Nothing is verified against live institutional pages** — no network access. Mitigated by honest
   labelling, `npm run check:links`, and never claiming "published".
3. **One "accessible" institution.** A student with a weak academic profile has few realistic safety
   options in our set.
4. **Costs and deadlines are a point-in-time snapshot**, not a live feed. Stated in the UI.
5. **English-language interface only.**

## Verification commands

```bash
npm run typecheck    # strict TypeScript
npm run test         # 124 unit tests
npm run build        # production build
npm run check:links  # real HTTP check of every source URL (needs internet)
```
