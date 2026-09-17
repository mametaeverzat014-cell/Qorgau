# Phase 1 — Audit of the current data model

Audit of every decision-critical field in `src/lib/types.ts` / `src/data/universities.ts`, performed
before any change. Baseline re-verified on entry: typecheck clean, **0 lint warnings, 124 tests
passing, production build clean (45 pages)**.

## Environment constraint that shapes everything below

Outbound network access is **blocked by organisation egress policy**. Verified directly:

```
https://www.mit.edu/          -> 000 (connect_rejected)
https://registrar.mit.edu/    -> 000 (connect_rejected)
https://www.hku.hk/           -> 000 (connect_rejected)
https://example.com/          -> 000 (connect_rejected)
```

Per the brief's Rule 3, this means: **build the architecture, parsers, validators, schemas, CLI tools
and tests; do not populate any record from pretrained knowledge.** Phase 16 (controlled expansion) is
explicitly conditioned on real internet access and is therefore **not performed**.

---

## Decision-critical field inventory

"Affects ranking" means the recommendation engine reads the field when scoring.

| Field | Current type | Provenance today | Source URL? | Academic year? | Last reviewed? | Parser-verifiable? | Affects ranking |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `estimatedTuition` | `Money` | field-level `confidence` (always `estimated`) | record-level only | **no** | record-level | yes — CDS / fee tables | **yes** (24% weight) |
| `estimatedLivingCost` | `Money` | field-level `confidence` | record-level only | **no** | record-level | yes — cost-of-attendance pages | **yes** (24%) |
| `fullRidePossible` | `boolean \| null` | **none** | no | no | record-level | partially — needs explicit policy language | **yes** |
| `fullTuitionPossible` | `boolean \| null` | **none** | no | no | record-level | partially | **yes** |
| `needBasedAidForInternationals` | `boolean \| null` | **none** | no | no | record-level | partially | **yes** |
| `aidCertainty` | `AidCertainty` | **none** | no | no | record-level | no — judgement from policy text | **yes** |
| `scholarshipAvailability` | enum | **none** | no | no | record-level | no | **yes** |
| `minimumIELTS` | `number \| null` | record-level `requirements` | no | no | record-level | yes — requirements pages | **yes** (8%) |
| `recommendedIELTS` | `number \| null` | record-level | no | no | record-level | rarely published | **yes** |
| `minimumTOEFL` | `number \| null` | record-level | no | no | record-level | yes | **yes** |
| `satPolicy` | enum | record-level | no | no | record-level | yes — CDS C8 / testing pages | **yes** |
| `minimumSAT` / `recommendedSAT` | `number \| null` | record-level | no | no | record-level | yes — CDS C9 percentiles | **yes** |
| `gpaExpectation` | `number` | **none** | no | no | record-level | partially — CDS C11 | **yes** (18%) |
| `admissionSelectivity` | enum | **none** | no | no | record-level | derivable from CDS C1/C2 | **yes** |
| `applicationDeadline` | `string \| null` | record-level `deadlines` | no | **no** | record-level | yes | **yes** (roadmap) |
| `scholarshipDeadline` | `string \| null` | record-level | no | **no** | record-level | yes | **yes** (roadmap) |
| `applicationPlatform` | `string` | record-level | no | no | record-level | yes | no |
| `supportedMajors` | `MajorKey[]` | **none** | no | no | record-level | yes — programme listings | **yes** (18%) |
| `programs` | `string[]` | **none** | no | no | record-level | yes | display |
| `researchIntensity` / `prestigeTier` | 1–5 | **none** | no | no | record-level | **no** — editorial judgement | **yes** (9%) |

## Findings

**F1 — Naked values on the highest-impact fields.** The aid block (`fullRidePossible`,
`fullTuitionPossible`, `needBasedAidForInternationals`, `aidCertainty`, `scholarshipAvailability`)
carries **no provenance at all**, yet it drives 34% of the weighted score between financial and
scholarship fit. `gpaExpectation` and `admissionSelectivity` are likewise naked and drive 18%.

**F2 — Provenance is record-level, not field-level.** `UniversityProvenance` assigns one status per
*class* of fact. A judge asking "where did this tuition number come from?" gets an institution-wide
answer, not a URL for that figure.

**F3 — No academic year anywhere.** Tuition and deadlines are cycle-specific and the schema cannot
express which cycle a value belongs to. This is the highest-risk correctness gap: a 2023 figure and a
2026 figure are indistinguishable in the current model.

**F4 — `sources` collapsed to one URL.** After the 404 fix, `sources.admissions`, `.tuition` and
`.scholarships` all hold the same canonical domain. The three-way structure now claims a precision the
data does not have.

**F5 — No retrieval timestamp per value.** Only `provenance.compiledOn` per record.

**F6 — Nothing distinguishes *derived* from *primary*.** Total cost of attendance is computed as
tuition + living, but a derived value has no way to declare its dependencies.

## Smallest clean migration

Deliberately **additive**, so no existing behaviour regresses:

1. Add `VerifiedValue<T>` and `SourceEvidence` as a **new, optional** evidence layer
   (`src/lib/provenance.ts`). Existing `Money` and the scalar fields stay exactly as they are.
2. Add an optional `evidence?: UniversityEvidence` bag on `University`, keyed by field name. Absent
   evidence continues to mean "curated", which is what the UI already says.
3. Keep the engine reading the existing flat fields, so ranking behaviour is unchanged and the 124
   existing tests keep passing untouched.
4. Build the pipeline to *produce* that evidence bag, and the UI to *display* it where present.

This is the smallest change that lets a judge answer "where did this number come from?" for any field
the pipeline has processed, without a risky rewrite of a working engine three days before submission.
