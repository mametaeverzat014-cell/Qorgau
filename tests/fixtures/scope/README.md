# Applicant-scope fixtures

A fictional institution, **Eastvale College**, whose admissions site is laid out
like the one that produced the live failure: a first-year page and a
visiting-undergraduate page side by side under `/admissions/apply/`.

The visiting page is deliberately the stronger-looking document — more
admissions keywords, an explicit current date, a canonical path — exactly as the
real one was when it beat the first-year page 22.5 to 16.5 and then supplied a
per-class fee, an English requirement and a testing policy to a first-year
record.

| fixture | scope |
| --- | --- |
| `apply-first-year-applicants.html` | `first_year` |
| `apply-visiting-undergraduate-students.html` | `visiting` — keyword-rich and dated |
| `apply-international-applicants.html` | `international_first_year` |
| `apply-transfer-applicants.html` | `transfer` |
| `graduate-admissions.html` | `graduate` |
| `cost-per-class.html` | `visiting`, priced per class |

Every figure, band, policy and date is invented. Nothing here is a claim about
any real institution, and no fixture value may be copied into
`src/data/universities.ts`.
