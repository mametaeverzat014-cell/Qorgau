# AdmitPath AI — pitch deck content (8 slides)

**Case:** LOCUSCASE2 «Маршрут поступления»
**Tagline:** From "Where can I apply?" to "What should I do next?"

Design guidance for whoever builds the slides: light background, one accent colour, large type, one
idea per slide. The notes are for the speaker, **not** for the slide. Nothing below should be pasted
onto a slide as a paragraph.

---

## Slide 1 — Problem

**Headline**
> A university list is not a plan.

**On slide** — four student quotes, one per line, large:
- "I don't know which universities fit me."
- "I can't tell what I can actually afford."
- "I don't know if my IELTS is enough."
- "I keep losing track of deadlines."

**Visual:** the four quotes as cards, nothing else.

**Speaker note (20s):** Existing tools return twenty university names and stop. Every hard question —
affordability, requirements, deadlines, sequencing — is left to a seventeen-year-old. The output is a
list, and a list is not a plan.

---

## Slide 2 — Solution

**Headline**
> One profile in. A personalized application route out.

**On slide** — a single horizontal flow:

```
Questionnaire → Diagnostics → Explained recommendations →
Comparison → Roadmap → Next action → Progress
```

**Visual:** that flow as a chevron strip. No body text.

**Speaker note (20s):** AdmitPath turns one two-minute questionnaire into seven connected outputs —
exactly the chain the case specifies. Not a search engine. A route.

---

## Slide 3 — User journey

**Headline**
> Two minutes to a route.

**On slide** — three product screenshots, captioned:
1. *Questionnaire* — "5 steps, never 20 fields on one page"
2. *Diagnostics* — "Where you stand, before any university list"
3. *Recommendations* — "Every result explains itself"

**Visual:** three screenshots in a row. Captions under, max 8 words each.

**Speaker note (25s):** We deliberately show diagnostics before the list. A student who sees eight
universities without first understanding their own position cannot evaluate them.

---

## Slide 4 — The wow moment

**Headline**
> Change one constraint. Watch the route change.

**On slide** — two real before/after panels, screenshots not text:

```
Budget: $5,000 -> $25,000
Funding requirement: full ride -> partial
 + 10 universities now financially compatible
 - Harvard dropped out   + CityU HK entered
```

```
Destination: USA + Hong Kong -> South Korea
 Top match: Berea College -> KAIST
 6 of 6 recommendations replaced
```

**Speaker note (30s):** This is the case requirement, and it is the live demo. Changing the country
turns the list over completely. Changing the budget also changes the funding requirement it implies —
and we say so, rather than pretending nothing else moved. Every line is computed from the before and
after states, not scripted.

---

## Slide 5 — How personalization works

**Headline**
> Seven dimensions. Zero black box.

**On slide** — the weighting, as a bar or donut:

| Financial fit | 24% |
| Academic alignment | 18% |
| Programme match | 18% |
| Geography | 13% |
| Scholarship compatibility | 10% |
| Preferences | 9% |
| Entry requirements | 8% |

**Plus one line, prominent:**
> Match score ≠ admission probability. We refuse to guess your chances.

**Speaker note (25s):** Deterministic, testable pure functions — same profile, same ranking, every
time. Three decisions we defend: financial fit is pessimistic by design, a missing SAT is scored as
unknown and never as zero, and we model no admission probability at all.

---

## Slide 6 — Trust

**Headline**
> No "Published" badge. On purpose.

**On slide** — the three states, as three chips:

| **Curated** | compiled from the institution's public materials |
| **Estimate** | our own figure, quoted from nobody |
| **Unverified** | we don't know, so we show nothing |

**Plus one line:**
> A badge a judge can disprove in thirty seconds is worth less than an honest one.

**Speaker note (25s):** Every cost is an estimate and labelled as one. Anything unverifiable stays
null rather than becoming a plausible number. We also model whether aid is *dependable* or a contest
you must win — which is why, for a student with $5,000, Harvard outranks TU Delft despite a $91,000
sticker versus $37,000.

---

## Slide 7 — Architecture and AI

**Headline**
> AI enhances the product. It is not the product.

**On slide** — the layer diagram:

```
UI → Profile State → Recommendation Engine (7 pure matchers)
   → Explanation → Diagnostics → Roadmap → Next Action → Progress
                                  ↑
                    [optional] AI rephrasing only
```

**Plus three lines:**
- Engine: deterministic TypeScript, no network, instant
- AI: optional, rephrases only, never decides
- If the AI fails, nothing breaks — 4 tests prove it

**Speaker note (25s):** We never ask a model "which universities fit this student?" The engine decides;
the optional AI layer may only rephrase what the engine already concluded, and the key stays
server-side.

---

## Slide 8 — Proof, and what comes next

**Headline**
> From "where can I apply" to "what should I do next".

**On slide** — proof first, four numbers:

| 124 | tests, including monotonicity and score reconstruction |
| 0/10 | corrupt-storage cases crash the app (was 7/8) |
| 64/64 | viewport combinations without overflow |
| 0 | admission probabilities claimed, anywhere |

**Then the path:**

```
curated dataset -> verified ingestion -> versioned cycle snapshots
                -> same deterministic engine -> student route
```

**Closing line, large:**
> A student should never have to ask "what do I do now?" twice.

**Speaker note (25s):** What is built works end to end and is deployed. What comes next is coverage and
localisation — the engine already scores whatever dataset we give it. What we would not change is
determinism: the moment ranking becomes a model output, nobody can answer the question a student
actually has.

---

## Optional appendix slide — future scalability

Only if a judge asks how this grows. Not part of the eight.

- Expand the curated dataset with the same sourcing discipline, verification timestamp per field
- Live deadline verification against official pages
- Counsellor view: one advisor, many student routes
- Russian and Kazakh localisation

---

## Total speaking time

~3 minutes across 8 slides. If cut to 5, keep **1, 2, 4, 6, 8** — problem, solution, the what-if
proof, the trust model, and the close. **Never cut slide 4**: it is the case requirement judges are
explicitly looking for.
