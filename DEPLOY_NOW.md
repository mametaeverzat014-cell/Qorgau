# Deploy AdmitPath AI — 2 minutes

The project is **zero-config**: no database, no authentication, **no required environment variables**.

## Verified before writing this

| Check | Result |
| --- | --- |
| `npm ci` from a clean clone | passes |
| `npm run build` | passes, 45 pages generated |
| Required env vars | **none** |
| Server routes without an API key | `/api/explain` returns the deterministic fallback, never 500 |
| Hardcoded localhost / dev URLs | none in `src/` |
| Dev-only imports in the bundle | none — Playwright is a devDependency, never imported by the app |
| `vercel.json` | not needed; framework auto-detects |
| Default branch | `claude/stoic-thompson-2zfzun` — already the branch holding the code |

## Route A — Vercel dashboard (recommended)

1. Open <https://vercel.com/new>
2. Import **`mametaeverzat014-cell/Qorgau`**
   *Not listed?* Click **Adjust GitHub App Permissions** → select the `mametaeverzat014-cell` account
   → grant access to `Qorgau` → **Save**, then reload.
3. Change nothing. The framework is detected as Next.js and the default branch is correct.
4. **Deploy**.

Every later push to the default branch redeploys automatically.

## Route B — CLI

```bash
git clone https://github.com/mametaeverzat014-cell/Qorgau.git
cd Qorgau
npm i -g vercel
vercel login      # sign in as mametaeverzat014-cell
vercel --prod
```

## Optional: the AI rephrasing button

Not required. Without it the button returns the engine's own explanation with a note, which is a
supported state covered by tests.

To enable: **Settings → Environment Variables** → add `ANTHROPIC_API_KEY`. Optionally
`ANTHROPIC_MODEL` (defaults to `claude-sonnet-5`). The key is read only inside the server route and is
never shipped to the browser.

## After deploying — 60-second smoke test

1. Open the URL in a **private window**.
2. **Try Demo Profile → Aizhan** → diagnostics appear, no university list yet.
3. **See recommendations** → 8 cards, each with "Why it matches you".
4. Budget **$5,000 → $25,000** → the "What changed?" panel appears.
5. Deselect USA and Hong Kong, select **South Korea** → the list turns over.
6. Open `/university/hku` directly → page renders, source link opens in a new tab.
7. Open `/nope` → styled 404, not a platform error page.

If all seven pass, the deployment is sound.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Repo not listed at vercel.com/new | Vercel GitHub App lacks access | Adjust GitHub App Permissions → add `Qorgau` |
| Build fails immediately | Wrong production branch | Settings → Git → set to `claude/stoic-thompson-2zfzun` |
| Build fails on install | Node version too old | Settings → General → Node.js 20.x or 22.x |
| Deploy succeeds, site 404s | Root Directory overridden | Settings → General → Root Directory must be empty |
