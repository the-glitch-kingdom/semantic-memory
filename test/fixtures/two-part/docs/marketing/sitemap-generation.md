---
title: How the Sitemap and llms.txt Are Generated (and How to Update Them)
tier: standard
feature: seo
domains:
  - marketing
  - devops
  - frontend
audience:
  - all
tags:
  - marketing
  - deployment
  - configuration
status: complete
last_updated: "2026-10-28"
version: "2.1.0"
purpose: How sitemap.xml (index plus pages/blog/faq children), llms.txt and
  IndexNow are generated at build time and how to change, deploy and verify
  them.
sources:
  - frontend/scripts/generate-sitemap.mjs
  - frontend/scripts/generate-articles-manifest.mjs
  - frontend/scripts/indexnow-submit.mjs
  - frontend/package.json
  - scripts/deploy-prod-frontend.sh
  - scripts/ci/guards.sh
  - frontend/src/features/marketing/manifest.js
  - frontend/src/features/marketing/manifest/company.js
  - frontend/public/robots.txt
  - frontend/public/sitemap.xml
  - frontend/public/sitemap-pages.xml
  - frontend/public/sitemap-blog.xml
  - frontend/public/sitemap-faq.xml
  - .documentation/devops/cloudflare-pages-deploy-workflow.md
  - workers/sitemap/src/builders.js
last_verified: '2026-11-10'
---

# How the Sitemap and llms.txt Are Generated

> **Update (2026-10-28): the sitemap is split.** `sitemap.xml` is now a **sitemap index**
> listing three children: `sitemap-pages.xml`, `sitemap-blog.xml` (`/blog`, posts,
> categories) and `sitemap-faq.xml` (`/faq`, topics, questions). GSC then reports
> coverage per section. `robots.txt` and the GSC submission still point at `/sitemap.xml`;
> submit the three children in GSC too so each gets its own coverage row. The generator
> writes all four files; `--check` (guards.sh #1) compares every file. FAQ questions that
> canonicalize to an owner (`FAQ_CANONICAL_OVERRIDES`) are never listed, and neither are
> `unlinked` manifest routes (the program pages `/academy`, `/careers`, `/affiliate-program`,
> `/partner-program`, out until launch per the 2026-10-28 decision; 152 → 148 URLs).
> After each prod deploy, `node frontend/scripts/indexnow-submit.mjs` notifies Bing (see
> **IndexNow** below).

> **Update (2026-06-11): the frontend migrated to Cloudflare Pages and the
> `acme-sitemap` Cloudflare Worker was RETIRED** (its zone routes were deleted).
> Prod no longer builds the sitemap live from `articles.json`. The earlier "Worker
> generates the sitemap at request time" model is no longer true.
>
> TL;DR: `acme.example/sitemap.xml` and `/llms.txt` are now **plain static files**
> served by Cloudflare Pages from the build output (`dist/sitemap.xml`, `dist/llms.txt`),
> generated at build time by `frontend/scripts/generate-sitemap.mjs` and
> `generate-llms-txt.mjs`. To change which URLs appear, edit the route **manifest** and
> **redeploy the frontend** (staging auto-deploys on merge to `main`; prod ships via the Cloudflare Deploy Hook
> wrapper, `scripts/deploy-prod-frontend.sh`). There is no Worker to redeploy anymore.
> Canonical references: `.documentation/devops/cloudflare-pages-deploy-workflow.md` and
> `.documentation/marketing/seo-surface-implementation.md`.

## The layers

1. **Build-time static generators** (`frontend/scripts/`), run in `npm run prebuild`:
   - `generate-articles-manifest.mjs` → `frontend/public/articles.json` (blog articles,
     categories, and the marketing route list; consumed by the build, not by a Worker).
   - `generate-sitemap.mjs` → `frontend/public/sitemap.xml` (index) + `sitemap-{pages,blog,faq}.xml`
     → built into `dist/`.
   - `generate-llms-txt.mjs` → `frontend/public/llms.txt` → built into `dist/llms.txt`.

2. **Cloudflare Pages static serving** — Pages serves `dist/sitemap.xml` and
   `dist/llms.txt` directly as static files at `acme.example/sitemap.xml` and
   `/llms.txt`. **This is what Google Search Console and crawlers actually receive.**
   There is no request-time generation and no `x-worker` header anymore.

> **Retired:** the `acme-sitemap` Cloudflare Worker (`workers/sitemap/`) that
> previously intercepted these paths and built them live from `articles.json`. Its zone
> routes were deleted in the 2026-06-11 Pages migration. The `workers/sitemap/` code may
> still exist in-tree for reference, but it is **not deployed** and does not serve prod.

```
MARKETING_ROUTES (src/features/marketing/manifest.js)  +  blog articles.js / categories.js
        │  generate-sitemap.mjs (prebuild; reads these sources directly, not articles.json)
        ▼
frontend/public/sitemap.xml  ──vite build──▶  dist/sitemap.xml  ──▶  Cloudflare Pages  ──▶  acme.example/sitemap.xml
        └─ generate-llms-txt.mjs ──▶ public/llms.txt ──▶ dist/llms.txt ──▶ Cloudflare Pages ──▶ acme.example/llms.txt
```

## Format decisions (why the sitemap looks the way it does)

- **`<loc>`-only** — no `<lastmod>`, `<changefreq>`, or `<priority>`. Google ignores
  changefreq/priority (and GSC reports them as unsupported), and a build-time `lastmod`
  reads as a **future date** to Google's crawler, which GSC rejects as "invalid date."
  `generate-sitemap.mjs` emits loc-only (the retired, undeployed `builders.js` still emits lastmod/changefreq/priority).
- **noindex and draft routes excluded** — the gated `/tools/<tool>/calc` pages carry
  `noindex: true` and `draft: true` routes are hidden; neither is ever in the sitemap. (`/pricing`
  is now a real indexed page and IS listed.) The
  load-bearing exclusion is in `generate-articles-manifest.mjs` and `generate-sitemap.mjs`.
  (The old `builders.js` Worker filter also excluded them defensively, but that Worker is
  retired and no longer serves prod.)

## Refreshing the live index (end-to-end runbook)

The full sequence to push a sitemap/llms.txt change live and clear Google Search Console.
Since the Worker was retired, the sitemap is just a static build artifact, so **a single
frontend deploy** ships any change (URLs *and* format):

| What changed | Deploy needed |
|---|---|
| Which URLs are listed (added/removed/`noindex`-ed a route or blog post) | **Frontend** |
| The output **format** (`generate-sitemap.mjs` loc-only logic, llms.txt sections) | **Frontend** |

1. **Merge the code first**, and regenerate + commit the build artifacts
   (`VITE_PUBLIC_MARKETING=true npm run prebuild` in `frontend/`).
   > ⚠️ **Order matters.** A prod frontend deploy that runs *before* the manifest change is on
   > `main` ships a **stale `sitemap.xml`**. Always deploy the frontend **after** the change merges.
2. **Frontend deploy** — for any sitemap/llms change (URLs or format). The build emits the
   static `dist/sitemap.xml` + `dist/llms.txt` that Cloudflare Pages serves directly.
   - **Staging**: auto-deploys on merge to `main` (`acme-frontend-staging`).
   - **Production**: auto-deploy is OFF (`acme-frontend-production`). Run `./scripts/deploy-prod-frontend.sh` (`--dry-run` first), which fires the
     Cloudflare Deploy Hook (a Git-connected Pages project has no "Create deployment" button);
     wait for the build to go live (~2-5 min). See
     `.documentation/devops/cloudflare-pages-deploy-workflow.md`.
3. **Verify** (next section) — expect 0 tags, no noindex routes, the expected `<loc>` count.
4. **Resubmit in GSC** once the live output is correct: `mcp__search-console-mcp__sitemaps_submit`
   (feedpath `https://acme.example/sitemap.xml`) or the Search Console dashboard.

## How to UPDATE the sitemap

### Add or remove a URL
1. Edit `frontend/src/features/marketing/manifest.js` (`MARKETING_ROUTES`). Add the route;
   set `noindex: true` to keep it **out** of the sitemap (e.g. a gated `/calc` page).
2. Regenerate the build artifacts and commit them:
   ```bash
   cd frontend
   VITE_PUBLIC_MARKETING=true npm run prebuild   # regenerates articles.json, sitemap*.xml, llms.txt, the press kit and functions/_route-manifest.mjs
   git add public/articles.json public/sitemap*.xml public/llms.txt functions/_route-manifest.mjs
   ```
   Prebuild runs the sitemap generator with `--keep-on-removal`, so it only adds URLs. To
   REMOVE a URL (or noindex a route), run `VITE_PUBLIC_MARKETING=true npm run sitemap -- --force` instead.
3. Deploy the **frontend** so the rebuilt static `dist/sitemap.xml` ships. Staging
   auto-deploys on merge to `main`; **production** ships via `./scripts/deploy-prod-frontend.sh`
   (Deploy Hook for `acme-frontend-production`). **No Worker redeploy
   exists anymore** — the sitemap is a plain static file.

### Change the sitemap's FORMAT (e.g. the loc-only logic, llms.txt sections)
That logic lives in `frontend/scripts/generate-sitemap.mjs` and `generate-llms-txt.mjs`. A
format change is just a code change to those generators: regenerate the artifacts
(`npm run prebuild`), commit, and deploy the frontend like any URL change above. (There is
no Worker `builders.js` to keep in sync anymore.)

## Parity test

The committed `frontend/public/sitemap.xml` / `llms.txt` must match what the generators
produce from the current manifest. Regenerate and diff after any change:
```bash
cd frontend && VITE_PUBLIC_MARKETING=true npm run prebuild   # rewrites sitemap.xml / llms.txt
git diff --stat public/sitemap*.xml public/llms.txt         # expect no diff if artifacts were already current
```
If the diff is non-empty, the committed artifacts were stale — commit the regenerated files.

## Verifying production

```bash
for s in pages blog faq; do curl -s https://acme.example/sitemap-$s.xml; done > /tmp/sm.xml   # the children; sitemap.xml is only the index
grep -c '<lastmod>' /tmp/sm.xml                                                       # expect 0 (loc-only; same for changefreq/priority)
grep -oE '/tools/[a-z-]+/calc<' /tmp/sm.xml | wc -l                                  # expect 0 (no noindex routes)
grep -c '<loc>' /tmp/sm.xml                                                           # expect the current URL count (148 in the committed files on 2026-11-10: pages 35, blog 52, faq 61)
```
The sitemap is now a static Cloudflare Pages file, so what you fetch is exactly the build
artifact from the last production deploy. Cloudflare's edge cache may hold a copy briefly;
if you just deployed, allow a short cache cycle (or purge the Cloudflare cache) before
judging, then **resubmit the sitemap in GSC**.
> Reference state (counts as of 2026-11-10): 0 tags, 148 `<loc>` (as committed 2026-11-10), 0 noindex (the `x-worker` header is gone since the 2026-06-11 Worker retirement).

## IndexNow (Bing)

Google ignores IndexNow; Bing, Yandex, Seznam and Naver honor it, and Bing's index feeds
ChatGPT search and Copilot. The key is public by design: `frontend/public/<KEY>.txt`,
served at `https://acme.example/<KEY>.txt`, with `KEY` in
`frontend/scripts/indexnow-submit.mjs`.

After a prod frontend deploy is **live and verified** (the deploy script prints a reminder):

```bash
node frontend/scripts/indexnow-submit.mjs --dry-run            # what would be sent
node frontend/scripts/indexnow-submit.mjs                      # every URL in the live sitemap
node frontend/scripts/indexnow-submit.mjs /blog/new-post /faq  # only what changed
```

It refuses to send when the live key file does not match (not deployed yet). HTTP 200 or
202 is success; 403 means the key file failed verification, 422 means a URL is not on the
host. Results show in Bing Webmaster Tools → IndexNow.

## Related
- `.documentation/devops/cloudflare-pages-deploy-workflow.md` — frontend deploy flow (Cloudflare Pages)
- `.documentation/marketing/seo-surface-implementation.md` — SEO surface implementation
- `frontend/src/features/marketing/manifest.js` — the route source of truth
- `.documentation/marketing/marketing-seo-pages.md` — the pages the sitemap lists
- `workers/sitemap/` — RETIRED Worker (kept in-tree for reference; not deployed)
