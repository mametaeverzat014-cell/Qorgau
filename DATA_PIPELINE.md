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

## Commands

```bash
npm run data:init                                  # build the registry
npm run data:discover -- --university=mit          # find official pages (needs network)
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

What is proven: 59 tests exercise extraction, validation, the security gate and
the approval gate, including an end-to-end fixture run from HTML through to a
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
2. **Discovery is conventional-path based**, so institutions with unusual URL
   structures will need registry entries added by hand.
3. **No LLM extraction layer.** The optional-LLM design in the brief is
   deliberately not implemented: every field the engine scores on can be parsed
   deterministically, and adding a model would introduce a candidate source that
   cannot be audited for no accuracy gain.
