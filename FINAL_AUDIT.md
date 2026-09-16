# AdmitPath AI — final judge-oriented audit

Self-assessment against every requirement in **LOCUSCASE2 «Маршрут поступления»**.

Everything below was **measured**, not asserted. The evidence column reports the actual output of an
automated browser run (26 checks) and the unit suite (62 tests), both reproducible:

```bash
npm run test                # 62 unit tests — engine and product guarantees
npm run build && npm start  # then the browser audit described in each row
```

**Result: 62/62 unit tests, 26/26 browser checks, 0 uncaught JavaScript errors.**

---

## 1. Official case requirements

| # | Requirement | Score | Evidence |
| --- | --- | --- | --- |
| 1 | **User questionnaire** | 5/5 | 5 steps, stepper, per-step validation, resume, ~2 min. Completed manually in the browser audit with no dead ends. |
| 2 | **Diagnostics** | 5/5 | `/diagnostics` renders 6 readiness dimensions + insights + gaps. Audit confirms **0 ranked university cards appear before it** — diagnostics genuinely precede the list. |
| 3 | **≥3 recommendations with explanations** | 5/5 | Returns 6–8. Audit: *8 returned, 8/8 carry explicit reasons*. Demo profiles: Aizhan 8, Daniyar 6, Madina 8. |
| 4 | **Comparison** | 5/5 | 15 dimensions, 2–4 universities, winning cells marked. Audit: *15 dimensions, 7 winning cells marked*. |
| 5 | **Personal roadmap** | 5/5 | Audit: *20 tasks across 5 months, 20 stating why they exist*. |
| 6 | **Next action** | 5/5 | Audit: *"Finish your university shortlist" → "Prepare financial aid documentation"* after completion. |
| 7 | **Progress tracking** | 5/5 | Audit: *progress 5% → 10%* on one task; 7 progress bars (overall + per-track). |
| 8 | **Country changes results noticeably** | 5/5 | Audit: *6/6 newly entered; top 3 all South Korean*. Complete turnover, every change named in the panel. |
| 9 | **Budget changes results noticeably** | 4/5 | Audit: *reordered=true, verdicts changed=true, 7 effects explained*; at no-limit, *8/8 became "Strong financial fit"*. See the caveat below. |

**Total: 44/45.**

### The one point deducted, and why

When the search is scoped to a **single country with few universities in our dataset** (e.g. USA,
where we curate 10), changing the budget reorders the list and flips every affordability verdict, but
the **set of 8 shown universities can stay the same** — because 8 of 10 are shown either way. The
"What changed?" panel still reports 7 concrete effects, so the student is never misled. With a wider
scope the membership changes substantially (measured: 10 universities entering the financially
compatible set). This is a **dataset-size limitation, not a logic failure**, and the honest fix is
more universities rather than a louder animation.

---

## 2. The eleven judge-mindset questions

| Question | Answer | Basis |
| --- | --- | --- |
| Does the product solve the stated case? | **Yes** | All seven required stages implemented and verified end to end. |
| Can a judge understand it in 10 seconds? | **Yes** | Hero states the promise; a preview panel lists the six outputs before any interaction. |
| Does the user journey feel complete? | **Yes** | Welcome → questionnaire → diagnostics → recommendations → comparison → roadmap → next action → progress → dashboard. |
| Do recommendations visibly respond to user data? | **Yes** | Every card names the student's own major, budget figure and country in its reasons. |
| Does changing budget visibly change output? | **Yes** | Reorder + verdict flips + a panel naming each effect. |
| Does changing country visibly change output? | **Yes** | Measured total turnover of the result set. |
| Is every recommendation explained? | **Yes** | 8/8 carry reasons; detail pages expose all 7 score components. |
| Can universities be compared easily? | **Yes** | Two clicks from the results screen; 15 dimensions with winners marked. |
| Does the roadmap tell the student what to do next? | **Yes** | 20 dated tasks, each with "Generated because: …", plus a single highlighted next step. |
| Does progress actually react to actions? | **Yes** | Only task completion and questionnaire completion move it. Nothing decorative. |
| Does it look like a startup, not an assignment? | **Yes** | Bespoke design system; no UI kit, no template, no Bootstrap dashboard. |

---

## 3. Definition of done

| Criterion | Status |
| --- | --- |
| I can open the site | ✅ HTTP 200 cold start |
| I can start onboarding | ✅ |
| I can complete the questionnaire | ✅ completed manually in the audit |
| I receive a diagnostic | ✅ 6 dimensions |
| I receive ≥3 university recommendations | ✅ 6–8 |
| Each recommendation explains why it matches | ✅ 8/8 |
| I can change budget and see meaningful changes | ✅ |
| I can change country and see meaningful changes | ✅ |
| I can compare universities | ✅ 15 dimensions |
| I receive a personalized roadmap | ✅ 20 tasks |
| I see my next action | ✅ |
| I can mark an action completed | ✅ |
| My progress updates | ✅ 5% → 10% |
| Demo profiles work | ✅ all three |
| Source links exist | ✅ 3 official links per university, 35/35 |
| Core recommendation tests pass | ✅ 62/62 |
| App builds successfully | ✅ from a clean clone |
| App is deployment-ready | ✅ zero-config Next.js, no required env vars |
| README satisfies hackathon requirements | ✅ |
| Demo-video script exists | ✅ `DEMO.md` |
| ≤8-slide pitch content exists | ✅ `PITCH.md` |

---

## 4. Robustness

| Scenario | Behaviour |
| --- | --- |
| Deep link with no profile | Redirects to `/onboarding` |
| Unknown university id | Graceful "University not found" state; **server stays up** |
| Nonsense route | Styled 404 with a route back |
| Comparison with 0 or 1 selected | Explains what to select and why |
| No results for the filters | Widens the search one step and says exactly why |
| AI provider absent / failing / slow / malformed | Deterministic explanation shown with a note (4 unit tests) |
| `localStorage` unavailable | Every read/write wrapped; app remains usable |
| Degenerate profiles (9 variants) | Always ≥3 results, finite scores, no crash (unit-tested) |
| 320px → 1920px | No horizontal overflow across 80 viewport/route combinations |

### Bugs found and fixed during this audit

Recorded because they are the kind a demo would otherwise expose live:

1. **Country step dead end.** "I'm open to anywhere" was a toggle that defaulted to on, so clicking it
   left the step invalid with a disabled Continue. Made it select-only — which then revealed that
   country chips were `disabled` while "anywhere" was active, meaning **a student could never select a
   country at all**. Both fixed: the two controls are now one coherent choice.
2. **`NoFallbackError` crash.** `dynamicParams = false` made an unknown university id take the server
   down instead of 404ing. Reverted to the default and added a styled global 404.
3. **Below-the-fold content invisible.** `Reveal` gated visibility on `IntersectionObserver`; when the
   observer never fired, whole sections stayed at `opacity-0`. Content is now visible by default.
4. **Raw ISO date in task copy** ("before 2026-10-30"). Fixed, plus a test that scans every generated
   string for ISO dates, unresolved templates, `undefined` and `NaN`.
5. **Three horizontal-overflow bugs** — header at exactly 768px, diagnostics CTA at 390px, source
   links at 320px. All fixed and covered by an 80-combination sweep.
6. **Comparison did not discriminate.** Three similar universities all reported "Programme fit" as
   their advantage. Now computed relative to the other universities in the table.

---

## 5. Honesty review

The easy version of this product invents an admission percentage and claims a huge database. We did
neither, and the audit verifies it:

- **No admission probability anywhere.** A unit test scans every generated string — summaries,
  reasons, concerns, insights, dimension details, task titles, descriptions and rationales — for
  probability claims across all three demo profiles. Zero matches.
- **Costs are labelled.** 4 "Estimate" and 4 "Published" badges on a single detail page, with a
  paragraph explaining the difference.
- **Unverifiable values are `null`.** A test asserts `confidence: 'unknown'` always pairs with a
  `null` value, so no invented number can reach the UI.
- **Every university links to three official pages.** 35/35 records.
- **AI is disclosed accurately.** The engine uses none; the optional layer only rephrases and is
  proven to fall back.
- **Limitations are stated in the README**, including dataset size, which is our weakest point.

---

## 6. Remaining weaknesses

Stated plainly rather than hidden:

1. **35 universities.** The binding limitation. It weakens budget sensitivity inside small country
   scopes (see the deducted point) and limits real-world usefulness. The engine is dataset-agnostic,
   so this is a data-collection problem, not an architecture problem.
2. **Costs and deadlines are point-in-time estimates**, not a live feed.
3. **Aid modelling is policy-level, not applicant-level.** "Affordable only with aid" is conditional
   by design.
4. **No persistence beyond the browser.** Deliberate for the MVP; also the privacy story.
5. **English-language interface only.** Russian and Kazakh localisation is the first thing we would
   add for this audience.

## 7. Verdict

The product satisfies every stated case requirement end to end, with the reasoning visible at each
step and the uncertainty stated rather than papered over. The single deducted point is a dataset-size
artifact that the "What changed?" panel already discloses to the student.
