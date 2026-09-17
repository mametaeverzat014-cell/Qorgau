# Discovery fixtures

A fictional institution, **Northbridge Institute of Technology**, served from
`https://nbitadmissions.org`.

The hostname is the point. It contains the substring `admissions`, which is what
broke discovery against MIT: candidate URLs were matched against the whole URL
string, so `nbitadmissions.org/sitemap-misc.xml` "matched" the admissions hint
and a sitemap was recorded as the admissions page.

Every number, requirement and deadline in these files is invented for the test.
Nothing here is a claim about any real institution, and no fixture value may be
copied into `src/data/universities.ts`.
