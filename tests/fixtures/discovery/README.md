# Discovery fixtures

A fictional institution, **Northbridge Institute of Technology**, served from
`https://nbitadmissions.org`.

The hostname is the point. It contains the substring `admissions`, which is what
broke discovery against MIT: candidate URLs were matched against the whole URL
string, so `nbitadmissions.org/sitemap-misc.xml` "matched" the admissions hint
and a sitemap was recorded as the admissions page.

The site then reproduces, in miniature, every false positive a live MIT run
produced once that bug was fixed:

| fixture | reproduces |
| --- | --- |
| `blog-international-history.html` | "An Early History of International Students at MIT" chosen as the international financial aid source |
| `blog-old-english.html` | "Hwæt! Did you know that you can study Old English at MIT?" chosen as the English proficiency source |
| `blog-sat-reinstated.html` | a 2022 announcement that the SAT/ACT requirement was returning, chosen as current testing policy |
| `blog-at-what-cost.html` | a student blog post chosen as the cost of attendance source |
| `apply-transfer-deadlines.html` | transfer deadlines chosen as the default deadlines source |
| `blog-majors.html` | a blog post standing in for an academics page |
| `dining-menus.html` | site navigation making an unrelated page look like an admissions page |

A second live run fixed those and surfaced four smaller ranking faults, also
reproduced here:

| fixture | reproduces |
| --- | --- |
| `apply-first-year-checklist.html` | a thin but dated page outranking a rich undated one, because currency sorted above the score |
| `afford-calculator.html` | a net-price calculator ("Estimate your cost") chosen as the cost-of-attendance source |
| `discover-majors-minors.html` | a real majors page losing to an `/apply/` page, because `/apply/` was canonical site-wide |
| `/apply/tuition-and-fees/` listed twice in `sitemap-apply.xml`, with and without a trailing slash | a page reported as its own runner-up |
| a `blogspot.com` link in `apply-financial-aid.html` whose name contains the acronym `nbit` | `dimitristheblogger.blogspot.com` presented as a possible MIT domain |

Every page carries the same global navigation, which advertises "how to apply",
"first year applicants", "admissions office", "tuition and fees" and "financial
aid" — the template contamination that gave nearly every real MIT page an
admissions score of 7-8.5.

Every number, requirement, date and deadline in these files is invented for the
test. Nothing here is a claim about any real institution, and no fixture value
may be copied into `src/data/universities.ts`.
