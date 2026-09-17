# Extraction fixtures

Pages for a fictional institution, used to test what the extractors read and,
more importantly, what they refuse to read.

| fixture | reproduces |
| --- | --- |
| `chrome-trap.html` | navigation and footer carrying $200,000, a scholarship claim, SAT wording, an IELTS band and a deadline, while the main content is about a library refurbishment |
| `cost-table-two-years.html` | a fee table with 2025-26 and 2026-27 columns |
| `cost-sections-by-year.html` | the same figures split across per-year heading sections |
| `cost-ambiguous-prose.html` | three academic years in flowing prose, attributable to nothing |
| `income-threshold.html` | "families with income below $200,000 attend tuition-free" — a live run read the threshold as tuition |
| `aid-generic.html` | a generic aid page that establishes nothing about international eligibility |
| `aid-competitive.html` | aid positively described as a contest |
| `aid-full-need.html` | full demonstrated need met, with international applicability stated |

Every figure, band and date is invented. Nothing here is a claim about any real
institution, and no fixture value may be copied into `src/data/universities.ts`.
