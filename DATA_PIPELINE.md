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
considered, pages fetched, pages classified, pages whose chrome was stripped,
candidates left unfetched and total requests.

Then **FOUND**, and for each result: the URL, `relevanceScore`,
`authorityScore`, `finalScore`, `sourceRole`, `audience`, `temporalStatus` with
any published or updated date, why it was selected, how it was discovered, and
the runner-up URL with the reason it lost.

Then **NOT FOUND**, distinguishing "nothing matched" from "a candidate was found
and refused", with the refused URL and the reason. Then any PDFs needing manual
reading, any cross-domain candidates, and a coverage note.

`--debug` additionally prints **external links observed** — hosts a trusted page
linked to whose ownership could not be established. They are information, not
candidates.

`--debug` adds every candidate with its fetch priority, HTTP status, content
type, per-kind relevance/authority scores, role, audience, temporal status and
the accept/reject reason.

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

---

## Source selection

Finding pages was the first problem. Choosing the *right* page is the second,
and it is the one a live run exposed.

### What went wrong the second time

With the sitemap bug fixed, a real run against MIT found 11 of 12 page kinds.
Most of them were wrong:

| kind | what it picked |
| --- | --- |
| `international_financial_aid` | a blog post, "An Early History of International Students at MIT" |
| `english_requirements` | a blog post, "Hwæt! Did you know that you can study Old English at MIT?" |
| `testing_policy` | a 2022 announcement that the SAT/ACT requirement was being reinstated |
| `tuition` | a blog post announcing a tuition-free income threshold |
| `cost_of_attendance` | a student blog post titled "At what cost?" |
| `deadlines` | the **transfer** deadlines page |
| `financial_aid` | a blog post about an aid tracking portlet |

Four causes, all general:

1. **Keyword relevance is not authority.** Nothing distinguished the
   institution's standing page from somebody's post about the same topic.
2. **Two concepts on one page is not one topic.** "International students" in a
   history section and "scholarship fund" three paragraphs later made a page
   about neither look like a page about both.
3. **Site chrome counted as content.** Almost every MIT page scored 7-8.5 for
   admissions, because the global navigation on every page says "how to apply",
   "first year applicants" and "admissions office". The classifier was reading
   the template.
4. **Recall was being optimised.** 11/12 with false positives is worse than
   7/12 that are right.

### Relevance and authority are scored separately

**Relevance** is what the page is about: `<title>` ×3, H1-H3 ×2, body ×1 (capped
at four distinct hits), path ×1, sitemap context ×0.5. Phrases count for more
than single words.

**Authority** is whether it is the institution's standing statement:

| signal | effect |
| --- | --- |
| path segment canonical **for this kind** | +2 each, capped +4 |
| article path segment (`/blogs/`, `/news/`, `/entry/`, `/archive/`, …) | −4, −1 per extra, capped −6 |
| article markers in the body ("posted on", "filed under", "leave a comment") | −2 |
| dated permalink (`/2019/04/…`) | −2 |
| audience, on kinds where it matters | first-year +2, undergraduate +1, transfer −4, graduate −7 |
| temporal status | current +2, unknown 0, dated −2, historical −4 |

**Canonicality is per kind.** There is deliberately no site-wide list of
canonical segments: a live run picked an application-essays page as the
canonical source for `programs`, because `/apply/` was on a global list and
outranked a real majors-and-minors page. `/apply/` is canonical for admissions
and for deadlines; it confers nothing on programs.

Authority is judged on **whole path segments**, never substrings.
`/news/admissions-office-moves-building` contains the word "admissions", but its
segments are `news` and `admissions office moves building` — so it earns no
canonical credit. An article path earns none at all, however many institutional
words its slug contains. A compound slug is matched from the front, because
slugs put their topic first: `majors-minors` is a majors page,
`essays-activities-academics` is not an academics page. The article list is
matched exactly, so `entry-requirements` is not read as a blog `entry`.

`finalScore = relevance + authority`, and **exactly one thing is
lexicographic — the role**. A canonical page beats a blog post whatever the
keyword scores say. Everything else, currency included, is a bounded score
adjustment that can tip a close call but never override a substantially better
page.

Some kinds demand more than keywords. `cost_of_attendance` requires one of a set
of clauses — "cost of attendance", "student budget", "annual cost", or tuition
together with housing, room and board, or food. The word "cost" alone is never
enough, and a net-price calculator that prints no figures is capped at
`supporting`: it is a real institutional service and not a source for what
something costs.

### Site chrome is stripped before classification

`mainContent()` removes `<nav>`, `<header>`, `<footer>`, `<aside>`, scripts,
styles and forms, then removes container elements whose class or id marks them
as furniture (menu, sidebar, breadcrumb, cookie banner, related posts, share
widgets, newsletter signup, pagination…), then prefers `<main>` or `<article>`
when the page marks one. A regression test takes a dining-menus page whose
navigation advertises "how to apply", shows it scores as an admissions page on
raw HTML, and shows its admissions content signal drops to **zero** once the
chrome is gone.

### Both concepts must be in the same place

Combined categories declare a `coRequire` pair, and the two groups must appear in
one semantic region: the title, one heading section, or a sliding 300-character
window **inside** a section. A window is never allowed to span a section
boundary — that is exactly how "international students" and "scholarship fund"
nearly passed as international financial aid.

`english_requirements` additionally requires a proficiency term (IELTS, TOEFL,
Duolingo, "proficiency", "language requirement"). The word "English" alone is
never evidence, and `hardNegative` terms — "old english", "english literature",
"english department", "creative writing" — disqualify a page outright, at any
score.

### First-year, not transfer

Every page gets an `audience`: `first_year`, `transfer`, `graduate`,
`international`, `all_undergraduate` or `unknown`. The product's default
applicant is a first-year undergraduate, so on audience-sensitive kinds
(admissions, deadlines, testing, English, programs) first-year and
all-undergraduate pages outrank transfer pages both in authority and in the
final ordering. A transfer page is demoted, not disqualified — if it is all that
exists, it is recorded *and labelled* `audience: transfer`.

### Announcements are not policy

Every page gets a `temporalStatus`: `current`, `dated`, `historical` or
`unknown`, alongside `publishedDate`, `updatedDate` and `academicYear` read from
the document's own metadata. A page is `current` only if it states the current
academic year or was updated within twelve months; `historical` if it is an
article using change-announcement language ("we are reinstating", "starting
in…", "effective from") or is more than two years old.

`unknown` is the default and is not a failure. Claiming a page is current when
nothing on it says so would be inventing the one property that matters most for
a policy that changes every cycle. **`unknown` is also not a demotion** — it is
worth exactly zero. A live run selected a thin essays page (final 16, dated)
over a deadlines-and-requirements page (final 21.5, undated) because currency
sorted above the score; it is now a ±2 adjustment inside the score.

**A `historical` source is never selected for a decision-critical field**, at any
score. That is precisely what made an announcement that the SAT requirement was
being reinstated look like a testing policy source.

### Source roles, and precision over recall

Every candidate carries a `sourceRole`:

| role | meaning |
| --- | --- |
| `canonical` | a standing institutional page at a canonical location |
| `supporting` | a standing page, but not at a canonical location |
| `fallback` | a blog, news or article page |
| `historical` | an article announcing a change rather than stating policy |

For the decision-critical fields — tuition, cost of attendance, financial aid,
international financial aid, testing policy, English requirements, deadlines — a
`fallback` source is selected only when nothing better exists **and** it clears a
raised bar (`FALLBACK_MIN`), and a `historical` source is never selected. When a
candidate is refused this way it is still reported, under **NOT FOUND**, with the
URL and the reason, so a human can look at it.

`7/12 high-confidence canonical sources` is the intended outcome. `11/12` with
false positives is not.

### Budget

Candidates are ordered **before** any request is spent, using path canonicality,
audience and kind relevance. URLs the site actually publishes in its sitemap are
a strictly higher tier than conventional-path guesses — a guess that *looks*
canonical used to outrank a real URL, which is how a live run spent all 45 page
fetches on 404s and never reached the pages in its own sitemap. The budget itself
is unchanged.

Candidates are also deduplicated by the URL a fetch actually lands on, after
redirects. `/afford/x` and `/afford/x/` are one page; a live run reported that
page as its own runner-up, having lost to itself 8 to 8.

### Cross-domain

Discovery never widens an allow-list. A linked host becomes a **domain
candidate** only when two conditions both hold:

1. it sits on a **restricted academic registry** — `.edu`, or a two-part `ac.*`
   / `edu.*` suffix — which are the only public suffixes here whose registrants
   are verified; and
2. its registrable label relates to the institution by **whole-token match** —
   equal to one of its name tokens, or the stem of one (`mit` is the stem of
   `mitadmissions`).

Anything else goes to **external links observed**, a `--debug`-only bucket, and
is never presented as a candidate. This is deliberately conservative because of
a real result: a trusted page linked to `dimitristheblogger.blogspot.com`, and a
substring test found "mit" inside "dimitris".

Candidates carry the link that produced them, the anchor text, the reason they
qualified, and the `add-domain` command that would approve one. Nothing in
either bucket is fetched, and a link is never proof of ownership — official
pages link to payment processors and testing agencies too.

Discovery also prints a coverage note naming the current allow-list and the kinds
with no approved source, because "not found" and "not reachable from this one
domain" are different problems.

---

---

## Extraction

Discovery decides which page to read. Extraction decides what the page says, and
a live ingest surfaced four faults in it.

### Extraction reads the page, not the template

`mainContent()` — the same function discovery uses, not a second implementation —
now runs before extraction too. Site navigation and footers routinely carry a
figure, a scholarship claim, an IELTS band and a deadline on every page of a
site; reading whole-page text let any of them become a candidate for any page.
The raw HTML stays on disk untouched, so provenance and debugging are unaffected.

### Year-aware money

A live run refused a whole cost-of-attendance page because it listed 2024-25,
2025-26 and 2026-27. Refusing was right — picking the nearest year in flattened
text is guessing — but the page's own table says which column is which year.

A figure now inherits a year only where the relationship is structural:

| source | meaning |
| --- | --- |
| `table-column` | the column header for this cell names a year |
| `table-row` | the row itself names exactly one year |
| `section` | the enclosing heading section names exactly one year |
| `page` | the whole page names exactly one year |

Anything else stays ambiguous and is refused as before, and the source of the
attribution is recorded on the proposal so a reviewer can check it. Nearest year
in flattened prose is never used.

Each candidate carries value, currency, unit, academic year, the year's source,
the excerpt and the source URL. Where several cycles are present, the most recent
attributable one is proposed.

### A number is not a price

A live run extracted $200,000 as tuition, from a sentence saying families with
income below that threshold attend tuition-free. The sentence contains the word
"tuition", so no keyword filter can catch it. Figures are now excluded when their
sentence is about income, assets, earnings, an award maximum or an eligibility
threshold — and the exclusions are **reported**, with the reason, rather than
silently dropped.

Within a sentence that prices several things, a figure belongs to the cost
component named nearest to it, so "tuition is $59,750 and housing is $12,500"
does not make $12,500 a tuition candidate. Totals are exempt from that rule,
because a cost of attendance legitimately enumerates its own components.

The plausibility ceiling remains as a second defence.

### Aid certainty is a three-state machine

The worst failure of the live run: a generic aid page that established nothing
about international eligibility proposed downgrading a `meets-full-need` record
to `competitive`, while the validator simultaneously reported that the page
established nothing. Both halves were wrong together.

Every aid field now carries `SUPPORTED`, `CONTRADICTED` or `UNKNOWN`. **Absence
of evidence is UNKNOWN, not false**, and an UNKNOWN field produces no proposal
at all.

| field | proposed only when |
| --- | --- |
| `aidCertainty: meets-full-need` | the page states full demonstrated need is met **and** that international students are eligible |
| `aidCertainty: competitive` | the page positively describes the award as a contest — "competitive", "selective", "a limited number", "not guaranteed" — in a sentence about aid |
| `aidCertainty: minimal` | the page states international students are excluded |
| `needBasedAidForInternationals`, `meetsFullNeedForInternationals`, `fullTuitionPossible`, `fullRidePossible` | the page states it, and states international applicability |

Mentioning scholarships is not evidence that aid is competitive. Failing to find
international eligibility is not evidence of anything. Not finding full-need
wording is not evidence against full need. In all of those cases the field
appears under **NO EVIDENCE** with the reason, the existing value stands, and
nothing is proposed.

### Four outcomes, not three

| outcome | meaning |
| --- | --- |
| `ACCEPT` | a value with evidence that passed validation cleanly |
| `REVIEW REQUIRED` | a value with evidence, carrying a warning or below the confidence threshold |
| `REJECT` | a value was extracted and failed validation |
| `NO EVIDENCE` | the sources were read and say nothing about this field |

The last one is the point. A field nobody has evidence for should not appear as a
changed candidate simply to force a binary choice, and "we read the page and it
does not say" is a different answer from "we read a value and refused it".
`review` also lists **figures found and not used**, with the reason.

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

What is proven: 176 tests exercise discovery, extraction, validation, the security
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
2. **The ranking layer has not been run against a live site.** Discovery itself
   has: a live MIT run found 11/12 kinds in 58 requests with no sitemap treated
   as evidence. The source-selection rules that replace those false positives
   are exercised only against fixtures — a sitemap index, four child sitemaps,
   canonical pages, five blog posts reproducing each real false positive, a
   calculator page, a chrome-heavy page, two PDFs, a hostile hostname and a
   blog host whose name contains the institution's acronym. Fixtures are not
   the internet. From this environment every request to a university domain
   returns HTTP 403 at the egress proxy, so the next live run is the real test.
3. **Each institution starts with one allowed domain.** Real institutions spread
   admissions, the registrar, student financial services and institutional
   research across several. Until a person approves the others with
   `data:add-domain`, discovery cannot see them — which is a deliberate
   trade: a narrow allow-list finds less and invents nothing.
4. **No LLM extraction layer.** The optional-LLM design in the brief is
   deliberately not implemented: every field the engine scores on can be parsed
   deterministically, and adding a model would introduce a candidate source that
   cannot be audited for no accuracy gain.
