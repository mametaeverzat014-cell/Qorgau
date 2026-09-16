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

## Slide 4 — Recommendation engine

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

## Slide 5 — Live product

**Headline**
> Change the budget. Watch the route change.

**On slide** — a genuine before/after of the "What changed?" panel:

```
Budget: $5,000 → $25,000
Funding requirement: full ride → partial
 + 10 universities now financially compatible
 − Harvard dropped out · + CityU HK entered
```

```
Destination: USA + Hong Kong → South Korea
 Top match: Berea College → KAIST
 8 options out · 6 options in
```

**Visual:** two stacked panels, real screenshots.

**Speaker note (30s):** This is the requirement the case names explicitly, and it is the live demo
moment. Changing the country turns the list over completely. Changing the budget also changes the
funding requirement it implies — and we say so, rather than pretending nothing else moved.

---

## Slide 6 — Architecture and AI

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

## Slide 7 — Why it is different

**Headline**
> Honest where others guess.

**On slide** — four contrasts, two columns:

| Typical tool | AdmitPath |
| --- | --- |
| "87% chance of admission" | Match score, explicitly not a probability |
| Sticker price or nothing | Best-case cost after published aid |
| Missing SAT = 0 | Missing SAT = unknown |
| Scraped 30,000 universities | 35 curated, every record source-linked |

**Speaker note (25s):** The easy version of this product invents an admission percentage and scrapes a
huge database. We did neither, on purpose. Every cost is labelled an estimate, every requirement links
to the official page, and unverified values are shown as unverified rather than filled in.

---

## Slide 8 — Roadmap and close

**Headline**
> From "where can I apply" to "what should I do next".

**On slide** — next steps, four bullets:
- Expand the curated dataset with the same sourcing discipline
- Live deadline verification against official pages
- Counsellor view: one advisor, many student routes
- Russian and Kazakh localisation

**Closing line, large:**
> A student should never have to ask "what do I do now?" twice.

**Speaker note (20s):** What is built today works end to end and is deployed. What comes next is
coverage and localisation — the engine already scales to whatever dataset we give it.

---

## Total speaking time

~3 minutes across 8 slides. If cut to 5 slides, keep **1, 2, 5, 7, 8** — problem, solution, the
what-if proof, the honesty contrast, and the close.
