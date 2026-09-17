# AdmitPath AI — answers to the hard questions

Truthful answers to what a hostile judge will actually ask. Where a number appears, it is measurable
in the repository.

---

### "Why should I trust your university data?"

Partly you shouldn't, and the product says so rather than hiding it.

35 institutions, hand-curated, not scraped. Every cost figure is labelled **Estimate** — our own
indicative number, quoted from nobody. Requirements, deadlines and aid policy are labelled **Curated**
— compiled from each institution's public materials when the dataset was assembled and not re-verified
since. Anything we could not establish is **Unverified** and stored as `null`, never as a plausible
guess.

There is deliberately **no "Published" badge**, because we did not re-verify these values against live
institutional pages, and a badge you could disprove in thirty seconds is worth less than an honest
one. Every university links to its official site, and `npm run check:links` HTTP-checks every URL in
the dataset.

### "Why isn't this just ChatGPT plus a form?"

Ask ChatGPT the same question twice and you get two different lists, with no way to audit either. Here
the ranking is a deterministic function of the profile:

- the same profile always produces the same ranking (tested)
- every score decomposes into seven weighted components, visible on every card
- **components × weights reconstruct the headline score to within a rounding point** (tested), so you
  can verify the arithmetic yourself rather than trusting us
- it runs offline, in the browser, with no API key

A language model cannot tell you *why* a university moved from third to seventh when you changed your
budget. This can, by name and by number.

### "What does the AI actually do?"

It rewrites explanations the engine already produced, and only when the student presses a button.

It cannot change a score, change eligibility, add a university, or introduce a fact — it receives the
engine's reasons and concerns and is instructed to rephrase without adding claims. The recommendation
engine never calls it. The product is fully functional with no API key configured, which is how it
runs today.

### "What happens if the API fails?"

Nothing, by design. Four tests cover the failure paths: no key, network failure, HTTP error status,
and a malformed or too-short response. Each returns the engine's own deterministic explanation with a
note saying why. The student always gets an answer.

### "Why did this university rank above another?"

Expand *"Why NN%? See the seven scores"* on any card. You get Financial fit (24%), Academic alignment
(18%), Programme match (18%), Location fit (13%), Scholarship compatibility (10%), Your preferences
(9%) and Entry requirements (8%), each scored 0–100.

The weights live in one file, `src/lib/weights.ts`. Nothing is hidden and nothing is random.

### "Why did changing the budget change the results?"

Because financial fit is the heaviest component, and because the budget also changes the *funding
requirement* it implies — a family that can pay $25,000 a year does not need a full ride, and we say
so rather than pretending nothing else moved.

The "What changed?" panel reports the actual computed difference: how many universities became
affordable without aid, which entered, which dropped out, whether the top match changed, and how
scholarship dependence across the shortlist moved. It is generated from the before/after states, not
from a script.

### "Is this predicting admission?"

No, and we refuse to. We do not model admission probability anywhere.

A match score describes alignment with the profile you entered. That is stated on the results screen,
in the card tooltips, in the expanded breakdown, in the comparison table and on every detail page. A
test scans every generated string — summaries, reasons, concerns, insights, task descriptions — across
all demo profiles for probability claims and finds none.

Inventing an admission percentage would be the single most harmful thing this product could do, and it
would be trivially easy. We didn't.

### "How current are the costs?"

They are a curated snapshot for the 2026–27 cycle, carrying a *"Record last reviewed"* date, not a
live feed — and the UI says exactly that. Costs vary by programme, citizenship and year, which is why
they are labelled Estimate and why every university links to its official site.

### "Why only 35 universities?"

Because we could verify that many properly, and the alternative was worse.

We ran the coverage analysis: nine countries hold exactly one university, only six institutions fall
under $15,000 total, and medicine and law sit at 7–8 each. The obvious move is to add more. We didn't,
because the build environment has no outbound network — writing new records from memory is exactly the
process that produced source URLs which 404'd in production.

So we made the limitation visible instead: every country chip shows how many universities we hold for
it, and scoping to a thin country explains that the search was widened. The engine is dataset-agnostic
— it scores whatever is in `universities.ts`. This is a data-collection problem, not an architectural
one.

### "What happens when data is unknown?"

It stays unknown. `null` with an **Unverified** badge, never a filled-in guess. A test asserts that an
`unverified` confidence always pairs with a `null` value, so an invented number cannot reach the UI.

The most important case is a missing SAT. It is **not** scored as zero — that would be the single most
damaging modelling error in this domain. It is treated as unknown, and only penalised where the
university actually requires or recommends a test. Where the test is not used at all, a missing score
costs nothing.

### "What does your match score actually mean?"

Alignment between your stated profile and a university's published characteristics, on seven
dimensions, combined with fixed weights.

It is not a ranking of university quality, and it is not your chance of getting in. A university can
score 92% because it fits your budget, your major and your location while still being extremely
selective — which is why every card also shows what to watch out for, and why *Strong Match* requires
a minimum academic component so a cheap nearby university is never called a strong match for a student
far below its intake.

### "How would this scale beyond a hackathon?"

The engine already scales; the data does not yet. The credible path is:

```
curated dataset  ->  verified ingestion pipeline  ->  normalised university records
                 ->  versioned admissions-cycle snapshots  ->  recommendation engine  ->  student route
```

Concretely: keep the deterministic engine and the provenance model exactly as they are, and replace
hand-curation with an ingestion pipeline that records a source URL and a verification timestamp per
*field* rather than per record. Snapshot each admissions cycle so a student's route is reproducible
against the data that existed when they planned it. `npm run check:links` is the first piece of that
pipeline and already runs in this repository.

What we would not change: the engine stays deterministic and auditable. The moment ranking becomes a
model output, nobody can answer the question a student actually has — *why this one, and why not that
one?*

### "What is the weakest part of this product?"

Dataset size, and we would rather say it than have you find it.

35 universities costs us a point on budget sensitivity: scoped to one country where we curate ten, a
budget change reorders the list and flips every affordability verdict, but may not change which eight
appear. The "What changed?" panel still reports the real effects, so a student is never misled — but
it is a thinner demonstration than it would be with 200 institutions.
