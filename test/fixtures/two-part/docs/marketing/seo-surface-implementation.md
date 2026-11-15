---
title: Marketing SEO/GEO Surface — Implementation & How to Extend
tier: standard
feature: seo
domains:
  - marketing
  - frontend
audience:
  - all
tags:
  - marketing
  - seo
  - geo
  - frontend
  - guide
status: complete
last_updated: "2026-07-19"
version: "1.1.0"
purpose: Explains how the marketing SEO/GEO surface is built (draft/publish
  gates, per-cluster manifest, nav internal-link guard, CI allowlist guard) and
  how to add, publish and verify a marketing page.
sources:
  - frontend/src/features/marketing/manifest.js
  - frontend/src/features/marketing/routes.jsx
  - frontend/src/components/seo/SEOHead.jsx
  - frontend/src/pages/index.jsx
  - frontend/src/features/marketing/config/cta.js
  - frontend/src/constants/pricingTiers.ts
  - frontend/src/features/marketing/config/leadForms.js
  - scripts/ci/marketing-allowlist-guard.mjs
  - .github/workflows/marketing-allowlist-guard.yml
  - scripts/ci/guards.sh
  - frontend/package.json
  - frontend/scripts/generate-sitemap.mjs
  - frontend/scripts/generate-llms-txt.mjs
  - frontend/scripts/inject-route-meta.mjs
  - frontend/public/robots.txt
  - workers/sitemap/src/builders.js
external_refs:
  - components/
last_verified: '2026-11-10'
---

# Marketing SEO/GEO Surface — Implementation & How to Extend

> How the scalable marketing surface is built: the draft/publish model, the per-cluster
> manifest, the navigation/internal-link guard, the page templates, and the control points.
> Read this before adding or publishing marketing pages.
>
> Route inventory: [Canonical Route Map](seo-geo-surface-route-map.md). Sitemap/llms
> pipeline: [Sitemap & llms.txt generation](sitemap-generation.md).

## What this is

The marketing surface scales toward 100-300 pages by being **template + data**, not hand-built
components. The marketing collaborator (or you) adds a page by writing a config entry and a thin
page file; the templates, build pipeline, and SEO-safety machinery are already in place. New pages
are **hidden by default** and become public only via a deliberate, reviewed flip — so the surface
can be built continuously without affecting the live, indexed pages.

## The two gates (how a page becomes public)

A marketing page is publicly indexed **only when ALL of these hold**:

```
production build  AND  VITE_PUBLIC_MARKETING=true  AND  !noindex  AND  !draft
```

- **Env gate** (`VITE_APP_ENV`, `VITE_PUBLIC_MARKETING`): `SEOHead.jsx` stamps `noindex` on every
  page unless `VITE_APP_ENV === 'production'`; marketing routes only register when
  `VITE_PUBLIC_MARKETING=true` (`MARKETING_ENABLED` in `frontend/src/pages/index.jsx`).
- **Per-route flags** (in the manifest):
  - `noindex: true` — permanently hidden (e.g. the gated `/calc` calculator pages).
  - `draft: true`, temporarily hidden until reviewed + published. **New pages default to this.**
  - `unlinked: true`, published but not in the sitemap and not linked from any page (the program
    pages, until launch); the sitemap generator filters on `!noindex && !draft && !unlinked`.

The two gates are orthogonal and reinforce each other: you can build and QA the full surface on
staging (env gate hides everything), and in production only non-draft pages index.

### ⚠ A third gate lives OUTSIDE this repo: Cloudflare zone settings

Both gates above are necessary and were **not sufficient**. Until 2026-07-19 the
Cloudflare zone independently refused every named AI crawler, so a page could pass
both gates and still be unreachable to AI answer engines.

Two separate zone controls did it, and either one alone reproduces the outcome:

| Control | Symptom | Who it stopped |
|---|---|---|
| `ai_bots_protection: "block"` | HTTP **403** | everyone, loudly |
| `is_robots_txt_managed: true` | injected `Disallow: /` per crawler | **the polite ones** |

The second is the one to remember. It **silently overrode `frontend/public/robots.txt`**,
which was already correct (`Allow: /`, app routes excluded, sitemap + `llms.txt`
pointers, zero AI-bot rules). No warning, no diff. The committed file and the served
file disagreed for an unknown period.

**Classic search was never affected** — `Googlebot` and `Bingbot` were not blocked —
so every metric anyone watched looked normal. Only the GEO surface was dark.

Both settings are now off and `robots.txt` is repo-owned on both public sites.
**When diagnosing a crawl problem on this zone, fetch the served `robots.txt` and
test with the actual crawler user-agent.** Reading the committed file, or the
Cloudflare dashboard's AI-policy panel, will both tell you it is fine.

```bash
curl -s https://acme.example/robots.txt | grep -E '^\s*Disallow'
curl -s -o /dev/null -w '%{http_code}\n' -A 'ClaudeBot/1.0' https://acme.example/
```

→ Full detail, including why the dashboard read "allowed" while the edge returned
403: `knowledge-base/facts/cloudflare-managed-robots-blocks-ai-crawlers-zone-wide.md`

## Where everything lives

| Concern | Location |
|---|---|
| Route manifest (per cluster) | `frontend/src/features/marketing/manifest/{tools,features,company,compare,solutions,dataProducts,content,product}.js` |
| Manifest index + `isPublished()` | `frontend/src/features/marketing/manifest.js` |
| Navigation IA + `publishedNav()` | `frontend/src/features/marketing/config/nav.js` |
| Page content configs | `frontend/src/features/marketing/config/{featuresContent,personaContent,dataProductsContent,...}.js` |
| Templates (shared renderers) | `frontend/src/features/marketing/components/{FeatureDetail,PersonaDetail,DataProductDetail,CompareTable}.jsx` |
| Thin per-route page files | `frontend/src/features/marketing/pages/*.jsx` |
| Calculator math | `frontend/src/features/marketing/math/*.js` |
| Pricing (shared source) | `frontend/src/constants/pricingTiers.ts` ← `shared/pricing/pricing.data.json` (#597) |
| CTA target | `frontend/src/features/marketing/config/cta.js` |
| Lead-form registry (form key → fields + `source`) | `frontend/src/features/marketing/config/leadForms.js` |
| Build pipeline | `frontend/scripts/{generate-sitemap,inject-route-meta,generate-llms-txt,generate-articles-manifest}.mjs` |
| Prod sitemap/llms Worker | `workers/sitemap/src/builders.js` (builds from `articles.json` at the edge) |
| CI allowlist guard | `scripts/ci/marketing-allowlist-guard.mjs` + `.github/workflows/marketing-allowlist-guard.yml` |

## How to add a page

A new page is three small edits, all in the free-edit allowlist:

1. **Content** — add an entry to the cluster's content config (e.g. `config/personaContent.js`
   for a persona, `config/dataProductsContent.js` for a data product).
2. **Page file** — add a thin wrapper at `pages/<Name>.jsx` that supplies a static `<SEOHead>`
   (literal strings — the prerender meta-injector reads these) and renders the shared template,
   e.g. `<PersonaDetail slug="..." />`. Copy an existing one (`SolutionHouseFlippers.jsx`).
3. **Manifest** — add the route to the cluster manifest with **`draft: true`**:
   ```js
   { path: '/solutions/wholesalers', componentName: 'SolutionWholesalers', draft: true }
   ```

That's it. The page is now live in-app for preview but excluded from `sitemap.xml` + `llms.txt`,
stamped `noindex`, and **not linked** from any nav or hub (the `isPublished()` guard). The page
component MUST exist or `routes.jsx` throws — that is intentional (a manifest entry without a
component is a bug, caught immediately).

### Calculators and data products

- **Calculator**: add pure math to `math/<tool>-math.js` (with a unit test under
  `frontend/tests/features/marketing/math/`), a calculator component, a landing page, and (if gated) a
  `noindex` `/calc` child. Follow the existing BRRRR/rental/flip pattern.
- **Data product**: `sampleRecords` MUST be **static + synthetic/anonymized** — never a live
  property/owner query (privacy + fork/SSG safety). Pricing links to `/pricing`, never hardcoded.

## How to publish (the reviewed flip)

Publishing is the single action that affects SEO, so it is the review gate:

1. Remove `draft: true` from the route's manifest entry (or set `draft: false`).
2. Regenerate + verify the sitemap: `cd frontend && VITE_PUBLIC_MARKETING=true npm run sitemap`
   (the `prebuild` hook also regenerates it; pre-push runs `--check`).
3. The page now enters `sitemap.xml` + `llms.txt`, drops `noindex`, and appears in nav/hubs.

**Publish in waves**, not all at once — a sudden sitemap explosion is a poor quality signal.
Lead with the highest-value pages.

## Navigation & the internal-link guard

`config/nav.js` defines the full mega-menu IA as data. The rendered nav comes from
`publishedNav()`, which filters to published items and drops empty groups — so the nav grows
automatically as pages publish, and **a draft page can never be linked from a live page** (Google
discovers pages via links, not just the sitemap). Every hub listing (`ToolsIndex`, `FeaturesHub`,
`SolutionsHub`) filters through `isPublished()` for the same reason.

Nav labels use the IA's wording while links point at the indexed slug (e.g. "Cash Flow Calculator"
→ `/tools/rental-calculator`). Update labels in `nav.js`; never rename an indexed slug.

## Control points (owned by this repo, not free-edit)

- **Pricing** renders from `shared/pricing/pricing.data.json` via `@/constants/pricingTiers`
  (`PUBLIC_PRICING_TIERS` = Silver/Gold/Platinum; Bronze is the hidden trial). Never hand-author
  prices or tier names — edit `pricing.data.json` + `npm run pricing:generate`.
- **CTA target** (`config/cta.js`): `registrationUrl()/loginUrl()` read `VITE_APP_URL` — relative
  today (one SPA), absolute to the app origin once marketing splits to its own Cloudflare Pages
  project. Single repoint surface.
- **Lead forms** (`config/leadForms.js`): registry of the rich lead forms. Every form submits to
  `POST /api/v1/leads` (`lib/marketing/leadsEndpoint.js`), and the backend owns the DB write and the
  Zoho upsert; the keys are legacy HubSpot GUIDs (HubSpot is decommissioned) and are not secret.
  See [grafted-content-surface.md](grafted-content-surface.md).

## The CI allowlist guard

`scripts/ci/marketing-allowlist-guard.mjs` classifies a PR's changed files: **free-edit** (pages,
config, manifest, math, blog data, academy, home, articles.json), **review-gated** (templates in
`components/`, `PricingPage`, legal), or **outside** (everything else). The workflow enforces only
when a PR has the `marketing-content` label or its author is in the `MARKETING_AUTHORS` repo
variable, so normal engineering PRs are unaffected. Make it a **required status check**. To change
what's free-edit vs gated, edit the `ALLOW` / `REVIEW_GATED` lists in the script.

## Verify locally

```bash
cd frontend
VITE_PUBLIC_MARKETING=true node scripts/generate-sitemap.mjs --check   # sitemap matches manifest
VITE_PUBLIC_MARKETING=true node scripts/generate-llms-txt.mjs --check  # llms matches manifest
npx vitest run tests/features/marketing/                               # draft guard + templates + math
VITE_PUBLIC_MARKETING=true VITE_APP_ENV=production npm run build       # full build + meta injection
```

A draft route's prerendered `dist/<path>.html` (flat output, not `<path>/index.html`) must contain `<meta name="robots" content="noindex,
nofollow">` and must NOT appear in the `public/sitemap-*.xml` files (`sitemap.xml` is now an index over `sitemap-pages.xml`, `sitemap-faq.xml`, `sitemap-blog.xml`).

> ⚠️ **The `draft`/`noindex` exclusion has FOUR consumers, not three.** Beyond the three above,
> `generate-articles-manifest.mjs` emits `articles.json`, and the **prod** `sitemap.xml` + `llms.txt`
> are built by the Cloudflare Worker (`workers/sitemap/`) from that file — NOT from the static
> `sitemap.xml`. When you change exclusion logic, update `generate-articles-manifest.mjs` too, and
> **verify against the live prod sitemap after deploy** (`curl https://acme.example/sitemap.xml`),
> not just the local static file. This caused a prod draft leak (49 vs 46) in PR #684.

## Related

- [Canonical Route Map](seo-geo-surface-route-map.md) — the full route inventory + status
- [Sitemap & llms.txt generation](sitemap-generation.md) — the discovery pipeline
- [Marketing SEO Pages](./marketing-seo-pages.md) — the original feature pages
- Plan + decision history: `marketing-seo-surface-graft-and-canonical-route-map` (folder no longer in the repo)
