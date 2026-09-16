# AdmitPath AI — submission checklist

**Case:** LOCUSCASE2 «Маршрут поступления»
**Deadline:** 19 September 2026, 12:00 Astana time

Items marked ✅ are complete in this repository. Items marked ⬜ require a human to perform an action
outside the repository (record a video, submit a form, paste a link) and **cannot be completed by the
build itself** — they are listed here so nothing is missed.

## Product

- [ ] **Deployed site is live and reachable** — the only product item still open.
      The code is deployment-ready and verified; see **Deploying** below. It needs
      one action from the repository owner that cannot be automated.
- [x] Deployed site works from a cold start with no account and no setup
      (verified against the production build locally: `npm run build && npm start`)
- [x] Questionnaire completes end to end
- [x] Diagnostics screen appears before the university list
- [x] At least 3 recommendations (product returns 6–8)
- [x] Every recommendation carries a written explanation
- [x] Changing **budget** produces a visible, explained change
- [x] Changing **country** produces a visible, explained change
- [x] Comparison view works for 2–4 universities
- [x] Personalized roadmap generated from the profile
- [x] Next action is shown and updates when completed
- [x] Progress tracking responds to real task completion
- [x] Demo profiles load in one click
- [x] Official source links present on every university
- [x] Empty, loading and error states handled; no crash paths found
- [x] Responsive from 390px to projector width
- [ ] **Test account if needed** — not applicable: no login exists

## Repository

- [x] GitHub repository is public / accessible to judges
- [x] Meaningful commit history from an empty repository, not fabricated
- [x] No API keys, secrets or `.env` files committed
- [x] `.env.example` documents every optional variable
- [x] `npm install && npm run build` succeeds from a clean clone
- [x] 62 automated tests pass (`npm run test`)
- [x] TypeScript strict mode passes (`npm run typecheck`)
- [x] Lint passes as part of the production build

## Documentation

- [x] `README.md` complete, mapping each case requirement to a feature
- [x] Recommendation methodology explained
- [x] Architecture diagram included
- [x] **Data sources disclosed** with official links per institution
- [x] **AI / APIs disclosed** — including that the engine uses none
- [x] **Ready-made components disclosed** — framework, icons, test runner
- [x] **Limitations disclosed** — eight of them, stated plainly
- [x] Local development commands documented and verified
- [x] Deployment instructions documented
- [x] Exact judge test scenario documented
- [x] Team roles section present (names to be filled in)
- [x] `DEMO.md` — ≤3 minute video script with timings
- [x] `PITCH.md` — content for ≤8 slides
- [x] `FINAL_AUDIT.md` — self-assessment against each case requirement

## Deploying — 2 minutes, repository owner

The repository is **public**, its default branch is `claude/stoic-thompson-2zfzun`, and the project is
zero-config: no database, no auth, and **no required environment variables**. Either route works.

**Route A — Vercel dashboard (recommended)**
1. Go to <https://vercel.com/new>.
2. Import `mametaeverzat014-cell/Qorgau`. If it is not listed, click *Adjust GitHub App Permissions*
   and grant Vercel access to that repository.
3. Accept every default — the framework is auto-detected as Next.js. Click **Deploy**.
4. Optional: add `ANTHROPIC_API_KEY` under Settings → Environment Variables to enable the
   "Rephrase with AI" button. The product is fully functional without it.

**Route B — CLI**
```bash
npm i -g vercel
vercel login
vercel --prod
```

Every later push to the default branch redeploys automatically under Route A.

- [ ] Deployment completed and the URL opens in a private browser window
- [ ] Run the judge test scenario in README once against the deployed URL

## Submission actions — require a human

- [ ] Fill real team member names into the README team table
- [ ] Record the demo video following `DEMO.md`, **≤3 minutes**
- [ ] Upload the video and confirm the link is publicly playable
- [ ] Build the slide deck from `PITCH.md`, **≤8 slides**
- [ ] Export the slides to **PDF**
- [ ] Use **LOCUSCASE2** in the participation code
- [ ] Submit the startup through **aistartify.com**
- [ ] Complete the moderation submission
- [ ] Open every submitted link in a private browser window and confirm it works
- [ ] Confirm submission before **19 Sep 2026, 12:00 Astana**

## Pre-demo run-through (do this the morning of judging)

- [ ] Open the deployed URL on the presentation machine
- [ ] Click **Clear my data**, reload, confirm the welcome screen is clean
- [ ] Run the full `DEMO.md` sequence once, timed
- [ ] Confirm the "What changed?" panel is legible at projector resolution
- [ ] Have the GitHub repository open in a second tab
- [ ] Have `README.md` open at the **Recommendation methodology** section, in case a judge asks how
      scoring works
