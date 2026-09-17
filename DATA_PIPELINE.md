# University data pipeline

How a number gets into AdmitPath, and how you can tell where it came from.

```
Official university sources
        |
Controlled ingestion      (allow-listed domains only)
        |
Extraction                (deterministic parsers, no model)
        |
Validation                (rejects the ways this data goes wrong)
        |
Human approval            (explicit, per field, required)
        |
Versioned verified dataset
        |
Recommendation engine
```

The property that matters: **no command except `approve` can write to production
data, and `approve` refuses to run without `--yes` from a person who has seen the
diff.** Ingestion proposes; people decide.

---

## Why this exists

The highest-weighted judging criterion is Accuracy and Verifiability, and this
project has already shipped two data defects worth learning from:

1. Source URLs written from pretrained knowledge returned **404 in production**.
2. A single `fullRidePossible` flag conflated *"we meet the full demonstrated
   need of every admitted international"* with *"a handful of competitive
   scholarships exist"* — for a student with no money, the whole decision.

Both came from the same root cause: a plausible-looking value with nothing behind
it. This pipeline makes that structurally harder.

---

## Source hierarchy

Only first-party official sources may back a decision-critical value. A search
engine can help you *find* an official page; the search result is never evidence.

| Rank | Source type | Notes |
| --- | --- | --- |
| 5 | `common_data_set` | Strongest available. Fixed schema, stable section codes, first-party |
| 4 | `official_pdf` | Fee schedules, prospectuses |
| 3 | `official_web` | Admissions, tuition, aid pages |
| 2 | `government` | Official education datasets |
| 1 | `other_official` | Official application systems |

Explicitly **not** acceptable: rankings sites, blogs, Reddit, consultancies,
study-abroad aggregators, search snippets, AI-generated summaries.

The registry pins which domains may speak for each institution. Redirects are
followed manually and **re-checked at every hop**, so a 302 from an official
domain to an unrelated one cannot become authoritative.

---

## Verification statuses

| Status | Meaning | Value may be non-null |
| --- | --- | --- |
| `verified` | Extracted from a first-party source, evidence attached | yes |
| `derived` | Computed from other fields; inherits the **weakest** input | yes |
| `curated` | Compiled by hand at dataset assembly, not re-verified | yes |
| `unverified` | Could not be established | **no — must be null** |

Two rules are enforced in code, not documented and hoped for:

- `verified()` **throws** if constructed without evidence.
- `derive()` inherits the weakest input status, so a verified tuition plus an
  unverified housing figure produces an **unverified** total. Laundering is
  impossible by construction.

---

## What validation refuses

Every rule exists because of a specific way this data goes confidently wrong.

| Trap | Behaviour |
| --- | --- |
| Monthly housing read as annual | **Rejected.** Understates cost ~12x and looks plausible |
| Per-credit tuition read as annual | Rejected |
| Page lists 2023-24 *and* 2026-27 | Rejected as ambiguous; no guessing which applies |
| Bare number with no currency | Rejected |
| Negative or >$120k annual tuition | Rejected |
| IELTS section minimum read as overall | Kept separate; section-only pages rejected |
| Two different overall IELTS minimums | Rejected, sent to review |
| Bare date treated as a deadline | Rejected — a date needs deadline wording |
| Date outside the current cycle | Rejected as stale |
| "Scholarships available" → full ride | **Never inferred** |
| "Full tuition" → full ride | **Never inferred** — living costs are separate |
| Aid restricted to domestic students | Recorded as `minimal`, not available to internationals |
| International eligibility not stated | Error; never inferred from generic aid wording |
| Full ride that denies full tuition | Hard consistency error |
| Total cost below tuition | Hard consistency error |
| Confidence 0.99 with no evidence | **REJECTED** — confidence alone never produces data |
| Cloudflare challenge page | Detected; not recorded as content |

---

---

## Discovery

Finding an institution's official pages is the step that most easily produces
confident nonsense, so it is the step with the most rules.

### What went wrong once

A real run against MIT reported `1/12 page kinds found in 25 requests`, and the
one page it "found" was:

```
admissions: https://mitadmissions.org/sitemap-misc.xml
```

Two bugs combined. Candidate hints were matched against the **whole URL string**,
and the host `mitadmissions.org` literally contains the substring `admissions` —
so every URL on that host matched the admissions hint, and the first `<loc>` in
the sitemap index won. Nothing then looked at what the document actually said, so
a sitemap became an admissions page. Ingestion afterwards produced 1,047 bytes of
XML, two empty field groups and zero proposals.

### The rules now

1. **A sitemap is a discovery source, never evidence.** `sitemap.xml`,
   `sitemap-*.xml`, a sitemap index, `robots.txt`, feeds and static assets are
   refused by `isNonContentUrl` before they can become candidates, again after
   redirects, again at fetch time, and again in the freshness check. `discover`
   also purges any such URL a previous run stored.
2. **Hostnames are never matched against topic keywords.** Path scoring reads
   `URL.pathname` only. `mitadmissions.org/sitemap-misc.xml` scores **0** for
   admissions, and for all eleven other kinds.
3. **A URL match alone never classifies a page.** Every candidate is fetched and
   scored on what it says: `<title>` (weight 3), H1-H3 (2) and body text (1,
   capped at four distinct hits). A phrase counts for more than a word. A
   candidate with zero signal from the document itself is rejected regardless of
   how suggestive its URL is.
4. **Required terms per kind.** `international_financial_aid` needs an
   international term *and* an aid term, so it cannot swallow every aid page.
5. **Negative signals.** News, blog, press, directory, login and archive pages
   are penalised. A news story headlined "Admissions office moves building" that
   mentions tuition is rejected.
6. **One page may support several kinds.** A "Tuition and Fees" page that also
   states a cost of attendance is recorded for both, and evidence is attached per
   field, not per page.

### The flow

```
root domain
  -> robots.txt              Sitemap: directives, allow-list checked per entry
  -> sitemap(s)              a <loc> that is itself a sitemap is followed, not classified,
                             even if the document claims to be a <urlset>
  -> recurse                 depth <= 3, <= 12 sitemap fetches, <= 20,000 URLs
  -> rank candidates         by path score, top 4 per kind, plus conventional paths
  -> fetch                   <= 45 pages, allow-listed, size/redirect/timeout capped
  -> classify by content     title + headings + body + path + sitemap context
  -> retain the strongest    per kind
```

### PDFs

A PDF is recognised as an official document — URL, title, academic year and
retrieval date are preserved — but nothing here reads PDF body text. It is
classified only from the title the document states about itself, or from a short
list of unambiguous filename phrases (`common data set`, `cost of attendance`,
`tuition and fees`, `fee schedule`). Anything else is listed under **FOR MANUAL
READING** rather than classified. Every discovered PDF is marked
`requiresManualReading`.

### What `discover` prints

Pages inspected, sitemap URLs discovered, non-content URLs skipped, candidates
considered, pages fetched, pages classified and total requests; then **FOUND**
with each URL, its score and the reason it was accepted; then an explicit **NOT
FOUND** list. `--debug` adds every candidate with its HTTP status, content type,
per-kind scores and the accept/reject reason.

### Domains

An institution rarely lives on one domain. The registry carries two lists:

| `officialDomains` | registrable domains the institution owns; any subdomain may produce evidence |
| `trustedSubdomains` | individual approved hostnames outside those domains |

`allowedDomains` is the derived union and is what the fetch layer reads. It is
never hand-edited. Widening it is a human decision:

```bash
npm run data:add-domain -- --university=<id> --domain=registrar.example.edu --yes
npm run data:add-domain -- --university=<id> --domain=example-aid.org --official --yes
```

Each entry is seeded with exactly one domain — the one its `officialUrl` points
at. It is deliberately not expanded from memory; a person checks that a domain
really is official before approving it.

---

## Commands

```bash
npm run data:init                                  # build the registry
npm run data:discover -- --university=mit          # find official pages (needs network)
npm run data:discover -- --university=mit --debug  # ...and print every candidate and why
npm run data:add-domain -- --university=mit --domain=<d> [--official] --yes
npm run data:probe-urls                            # check officialUrl, suggest mechanical variants
npm run data:ingest   -- --university=mit          # fetch -> extract -> validate
npm run data:review   -- --university=mit          # show candidates, evidence, diffs
npm run data:approve  -- --university=mit --fields=tuition,minimumIELTS --yes
npm run data:diff                                  # approved vs shipped dataset
npm run data:check-freshness                       # broken / changed / current
npm run data:coverage                              # coverage report
npm run data:status                                # pipeline state
npm run check:links                                # HTTP-check every source URL
```

### Adding a university

1. Add the record to `src/data/universities.ts` with `officialUrl` set and any
   unverifiable field left `null` with `unverified` provenance.
2. `npm run data:init` — the registry picks it up and derives its allowed domain.
3. `npm run data:discover -- --university=<id>` to populate page URLs, or add
   them by hand to `data/registry/universities.registry.json`.
4. `npm run data:ingest -- --university=<id>`
5. `npm run data:review -- --university=<id>` and read each candidate's evidence.
6. `npm run data:approve -- --university=<id> --fields=... --yes`

**If a field cannot be verified, leave it null.** An unverified null is a
correct answer; a plausible guess is not.

### Updating a university

`npm run data:check-freshness` flags sources whose content hash has changed since
approval. Re-run ingest and review for those. Production is never updated
automatically.

---

## Directory layout

```
data/
  registry/    which domains may speak for each institution  (committed)
  raw/         fetched documents exactly as received          (gitignored)
  extracted/   candidate values with evidence                 (gitignored)
  approved/    values a human approved                        (committed)
```

Raw and extracted are gitignored because they are large, reproducible and
intermediate. Approved data is committed because it is the audit trail.

---

## Security

Fetched sites are untrusted input. The gate enforces: https only; no credentials
in URLs; no non-standard ports; allow-listed domains only, with suffix confusion
handled (`mit.edu.evil.com` does not match `mit.edu`); DNS resolution checked
against private, loopback, link-local and cloud-metadata ranges; redirects
re-validated per hop; response size capped by both `content-length` and
mid-stream; content-type allow-list; ids restricted to `[a-z0-9-]` so nothing can
escape the data directory; per-host delay and per-domain page caps.

## Performance

The pipeline **never runs during a user request**. The app reads the local
approved dataset and responds immediately. Ingestion is a manual or scheduled
offline job.

## Automation

`.github/workflows/data-freshness.yml` runs weekly. It has `contents: read` and
contains no `git commit` or `git push`, so it structurally cannot change a
university fact. It reports broken and changed sources and uploads the report.

---

## Current state and limitations

**The pipeline is built and tested; it has not been run against live sources.**
The environment this was developed in blocks all outbound network access
(verified: `mit.edu`, `hku.hk`, `example.com` all rejected by egress policy).

Consequently:

- **0 of 35** institutions currently have source-backed approved fields.
- Every record remains hand-curated, and the UI says so: detail pages show
  **"Hand-curated record"** rather than implying verification that has not
  happened.
- Registry page URLs are `null` rather than guessed. Guessing them is exactly
  what produced the 404s.
- Four `officialUrl` values in the shipped dataset do not respond
  (`u-tokyo.ac.jp`, `skku.edu`, `admissions.purdue.edu`, `postech.ac.kr`).
  `npm run data:probe-urls` reports them and lists mechanical variants of the
  URL already on record — dropping a `www.`, climbing to the parent host. It
  does not propose a replacement from memory and does not edit the dataset. A
  variant that responds is a lead, not a confirmation.

What is proven: 99 tests exercise discovery, extraction, validation, the security
gate and the approval gate, including an end-to-end fixture run from HTML through to a
verdict. Twelve red-team scenarios — monthly housing, mixed academic years,
domestic-only scholarships, stale SAT policy text, old PDFs, aggregator domains,
hostile redirects, bot challenges, low confidence, blank pages, disagreeing
sources, missing currency — **all fail honestly**, returning
`UNVERIFIED` or `REVIEW_REQUIRED` rather than a confident wrong answer.

To populate real data, run the commands above from a machine with normal internet
access. Nothing else is required.

### Known limitations

1. **PDFs are fetched but not parsed.** No text layer and no OCR ship with this
   pipeline, because a half-working PDF parser produces confident-looking
   garbage. PDFs are flagged for manual reading instead.
2. **Discovery has not been run against a live site.** It is exercised against
   realistic fixtures — a sitemap index, three child sitemaps, four real-shaped
   pages, a news page, two PDFs and a hostile hostname — but fixtures are not
   the internet. Against MIT from this environment every request returns HTTP
   403 at the egress proxy, and discovery correctly reports **0/12 found** and
   records nothing.
3. **Each institution starts with one allowed domain.** Real institutions spread
   admissions, the registrar, student financial services and institutional
   research across several. Until a person approves the others with
   `data:add-domain`, discovery cannot see them — which is a deliberate
   trade: a narrow allow-list finds less and invents nothing.
4. **No LLM extraction layer.** The optional-LLM design in the brief is
   deliberately not implemented: every field the engine scores on can be parsed
   deterministically, and adding a model would introduce a candidate source that
   cannot be audited for no accuracy gain.
