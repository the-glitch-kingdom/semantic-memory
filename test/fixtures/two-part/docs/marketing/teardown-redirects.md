---
title: Marketing Layer Teardown / Redirect Reference
tier: guide
domains:
- features
- marketing
audience:
- developers
- devops
status: complete
last_updated: 2026-06-11
version: 1.0.0
tags:
- features
- configuration
- deployment
purpose: 'How to take the marketing layer (/tools/*, /compare/* and the other
  manifest pages) offline: flip VITE_PUBLIC_MARKETING, add 301 redirects, remove
  code, regenerate the sitemap.'
sources:
- frontend/public/_redirects
- frontend/src/pages/index.jsx
- frontend/src/features/marketing/manifest.js
- frontend/src/features/marketing/manifest/tools.js
- frontend/src/features/marketing/manifest/compare.js
- frontend/src/features/marketing/routes.jsx
- frontend/scripts/generate-sitemap.mjs
- frontend/package.json
- frontend/.env.development
- frontend/.env.production.example
- frontend/src/components/shared/MarketingHeader.jsx
- frontend/src/components/shared/MarketingMobileMenu.jsx
- frontend/src/features/marketing/config/toolGates.js
- frontend/public/articles.json
- frontend/functions/[[path]].js
- .documentation/devops/cloudflare-pages-deploy-workflow.md
last_verified: '2026-11-10'
---

# Marketing Layer — Teardown / Redirect Reference

> **Status (2026-04-23)**: `/tools/*` and `/compare/*` are decided PERMANENT. This
> document is kept as a safety contingency only. If priorities ever shift, follow
> the instructions below.
>
> **This file is NOT live config.** It lives in `.documentation/marketing/`, not in
> `frontend/public/` or any build input, so no build step or CDN can interpret it. It is documentation of how to remove the marketing
> layer, not a config that does so.

---

## Instant rollback (no code change)

Set `VITE_PUBLIC_MARKETING=false` in the Cloudflare Pages project environment
variables for the frontend project, then trigger a rebuild. Every route
registered by `MarketingRoutes()` (the `frontend/src/features/marketing/manifest/*.js` files:
`/tools/*`, `/compare/*`, features, solutions, pricing, company and content pages, not just
tools and compare) stops being mounted and falls through to the 404 handler. The flag is
read in `frontend/src/pages/index.jsx`, `components/shared/MarketingHeader.jsx`,
`components/shared/MarketingMobileMenu.jsx` and `features/marketing/config/toolGates.js`, and by the build scripts (`generate-sitemap.mjs`, `generate-articles-manifest.mjs`, `inject-route-meta.mjs`, `snapshot-routes.mjs`, `check-seo-invariants.py`).

> **Frontend hosting moved to Cloudflare Pages (2026-06-11).** The frontend now ships
> via two Cloudflare Pages projects: `acme-frontend-staging` (auto-deploys on
> merge to `main`) and `acme-frontend-production` (auto-deploy OFF; ships via
> `./scripts/deploy-prod-frontend.sh`, a Deploy Hook; the dashboard has no "Create deployment" button). Canonical reference:
> `.documentation/devops/cloudflare-pages-deploy-workflow.md`.

| Env | Where to set | Rebuild required? |
|---|---|---|
| dev | `frontend/.env.development` | Restart `npm run dev` |
| staging | Cloudflare Pages → `acme-frontend-staging` → Settings → Environment variables | Yes, Vite bakes env at build (auto-deploys on merge to `main`) |
| prod | Cloudflare Pages → `acme-frontend-production` → Settings → Environment variables | Yes, Vite bakes env at build (then run `./scripts/deploy-prod-frontend.sh` to rebuild) |

---

## Full teardown (if we ever remove the feature)

### 1. Flip the flag (as above)

### 2. Add 301 redirects to preserve any SEO equity

**Hosting is Cloudflare Pages (since 2026-06-11)**, so redirects go through Cloudflare,
NOT a DigitalOcean app spec or an nginx container. The simplest path is the Cloudflare
Pages `_redirects` file; for status-code control or more complex matching, use Cloudflare
Rules (Redirect Rules) on the zone. See `.documentation/devops/cloudflare-pages-deploy-workflow.md`.

#### Option A: Cloudflare Pages `_redirects` (recommended)

Add rules to `frontend/public/_redirects` (it already exists, holding the #947 redirects and a
final `/*    /index.html    200` SPA catchall; new lines go ABOVE the catchall because the
first match wins; Cloudflare Pages serves it from the build output). One rule per line, `301` is the default for a `from to` pair:

```
# Marketing layer retired YYYY-MM-DD — preserve SEO equity with 301 redirects
/tools/brrrr-calculator        /blog/how-to-analyze-a-real-estate-deal      301
/tools/rental-calculator       /blog/how-to-build-real-estate-portfolio     301
/tools/fix-and-flip-calculator /blog/fix-and-flip-project-management        301
/tools/mao-calculator          /blog/what-is-arv-real-estate                301
/tools/cap-rate-calculator     /blog/cap-rate-vs-cash-on-cash-return        301
/tools/mortgage-calculator     /                                            301
/tools/ai-coach                /                                            301
/compare/dealcheck             /                                            301
/compare/biggerpockets         /                                            301
```

Redeploy the frontend to publish (staging auto-deploys on merge to `main`; prod ships via
`./scripts/deploy-prod-frontend.sh`).

#### Option B: Cloudflare Redirect Rules (zone-level)

For redirects you want to manage outside the build (or apply without a frontend redeploy),
add Redirect Rules in the Cloudflare dashboard (Rules → Redirect Rules) on the
`acme.example` zone, mapping each retired path to its target with a 301.

### 3. Delete code

```bash
rm -rf frontend/src/features/marketing/
```

Not a clean delete: code outside that folder imports from it (`src/pages/index.jsx`,
`src/components/shared/MarketingFooter.jsx`, `src/features/home/components/Home.jsx`,
`src/features/calculators/components/CalculatorDetail.jsx`, `src/lib/marketing/attribution.ts`,
`src/stories/marketing/*`). Fix or remove those imports first.

Revert the gate in `frontend/src/pages/index.jsx` (the `MarketingRoutes` import, the
`MARKETING_ENABLED` const and the `{MARKETING_ENABLED && MarketingRoutes()}` line).

### 4. Remove the env var

Remove `VITE_PUBLIC_MARKETING` from `frontend/.env.development`,
`frontend/.env.production.example`, and the Cloudflare Pages project env settings
(both `acme-frontend-staging` and `acme-frontend-production`,
Settings → Environment variables).

### 5. Regenerate sitemap

From `frontend/`: `npm run sitemap -- --force` (without `--force` the generator refuses to
remove URLs, and the prebuild runs it with `--keep-on-removal`; run it with `VITE_PUBLIC_MARKETING` unset or false). The output is a `sitemap.xml` index plus `sitemap-{pages,blog,faq}.xml`. Marketing routes drop out of `sitemap.xml` because the generator reads the
manifest, which only lists them when `VITE_PUBLIC_MARKETING=true`.

### 6. Submit updated sitemap to Google Search Console + Bing Webmaster Tools

This triggers deindex of the removed URLs.

---

## Redirect target rationale

Each `/tools/*` redirects to the closest-topic blog post so Google can transfer
PageRank. `/compare/*` redirects to homepage (no perfect topic match). If the
feature is retired, these targets should be verified still-current before
applying.
