---
title: Grafted Content Surface (FAQ, webinars, podcast, press, case studies, demo)
tier: standard
feature: marketing
domains:
  - features
  - frontend
audience:
  - all
tags:
  - features
  - marketing
  - seo
  - integration
status: complete
last_updated: "2026-06-20"
version: "1.0.0"
purpose: 'Describes the AD-fork content pages grafted onto the SEO surface
  (FAQ, webinars, podcast, press, case studies, book-demo, lead magnets): which
  are published vs draft, where content and routes live, how the lead forms
  submit, and how to publish a page.'
sources:
  - frontend/src/features/marketing/manifest/content.js
  - frontend/src/features/marketing/manifest/company.js
  - frontend/src/features/marketing/routes.jsx
  - frontend/src/features/marketing/config/leadForms.js
  - frontend/src/features/marketing/components/HubSpotForm.jsx
  - frontend/src/features/marketing/config/pressReleasesContent.js
  - frontend/src/features/marketing/components/CaseStudyDetail.jsx
  - frontend/src/lib/marketing/leadsEndpoint.js
  - frontend/scripts/generate-sitemap.mjs
  - scripts/ci/marketing-allowlist-guard.mjs
  - frontend/tests/e2e/marketing/graft-draft-surface.spec.ts
  - frontend/tests/features/marketing/leadForms.test.js
  - frontend/tests/features/marketing/faqPublish.test.js
  - backend/app/routers/leads.py
external_refs:
  - data/
  - marketing/data/
last_verified: '2026-11-10'
---

# Grafted Content Surface

> **Updated (#888, 2026-07-08):** the lead forms here (`HubSpotForm.jsx` + `config/leadForms.js`)
> no longer dual-write to HubSpot + Supabase. They now do a single `POST /api/v1/leads` and the
> **backend** owns the `tool_gate_leads` write + Zoho CRM upsert (`tool = form.source`). The
> `HubSpotForm` name is legacy. See [lead-intake-system.md](../revops/lead-intake-system.md). The
> submit-plumbing section below describes the current backend-owned flow.

A batch of marketing content pages cherry-picked from the AD (Alex Doe, CMO)
fork PR (`contributor-fork/acme-app#1`) and re-grafted onto the post-#683 SEO
surface. The fork was authored against a pre-#683 architecture (monolithic
`manifest.js`, a backend webinars feature, a tool-gate rewrite); only the **content
pages** were taken, re-expressed in the current split-manifest / draft model. The
fork's architectural rewrites were dropped.

**Most of the remaining pages ship `draft: true`** (webinars, podcast, case studies, `/lp/*` lead magnets; `/press` and `/book-demo` were published 2026-06-22) — built and reachable by direct URL but off the
sitemap + `llms.txt`, robots `noindex`, and unlinked from nav (the `isPublished()`
guard). Publishing a page is a deliberate per-page `draft`-flag removal after content QA.

**Exception — the FAQ is PUBLISHED** (full programmatic-SEO surface): the 6
`/faq/<topic>` hubs are indexable, and the 65 dynamic `/faq/:topic/:question` pages are
enumerated into the sitemap + prerendered meta from `config/faqTopicsContent.js` (the
FAQ blocks in `generate-sitemap.mjs` + `inject-route-meta.mjs`, since the templated
pages use variable `SEOHead` props the regex extractor can't read). The `/faq` hub
(`FaqPage`) lists the topics. The sitemap is a sitemap index with `sitemap-pages.xml`, `sitemap-faq.xml` and `sitemap-blog.xml`
(`scripts/generate-sitemap.mjs`); a FAQ question whose rel=canonical points at an owner page is
deliberately left out of the sitemap but stays live. See [sitemap-generation.md](sitemap-generation.md). `frontend/tests/features/marketing/faqPublish.test.js` guards the publish state.

**Design system:** every page renders through `MarketingLayout` (which injects the
centralized "Sora Light" tokens from `config/marketing-theme.js`); the two standalone
components — `SqueezeLayout` (injects `marketingCssVars` itself) and `HubSpotForm` —
use the same `--blue/--green/--text/--muted/--border-dim/--bg` tokens + Sora font.

## What was grafted

| Surface | Routes | Component(s) | State |
|---|---|---|---|
| FAQ (programmatic SEO) | `/faq/<topic>` (6) + dynamic `/faq/:topic/:question` (65) | `pages/faq/Faq*` + `FaqTopicPage` / `FaqQuestionPage` | **published** |
| Webinars | `/webinars`, dynamic `/webinars/:slug` + `/webinars/:slug/watch` | `WebinarPage`, `WebinarDetailPage`, `WebinarWatchPage` | draft |
| Podcast | `/podcast`, `/podcast/become-a-guest` | `PodcastPage`, `PodcastBecomeGuest` | draft |
| Press | `/press` | `PressPage` | **published** (2026-06-22, `e7836e2b`) |
| Case studies | `/case-studies` + 4 individual | `CaseStudiesPage`, `CaseStudy*` | draft |
| Book a demo | `/book-demo` | `BookDemoPage` | **published** (2026-06-22, `e7836e2b`) |
| Lead magnets (squeeze) | `/lp/brrrr-playbook`, `/lp/flip-checklist-guide`, `/lp/wholesaling-guide` | `Lp*` + `SqueezeLayout` | draft |

Content data lives in `frontend/src/features/marketing/config/` (NOT `data/`, the CI
allowlist `scripts/ci/marketing-allowlist-guard.mjs` only frees `pages/`, `config/`, `manifest/`
and `math/`, so a `marketing/data/` folder falls outside it and fails the guard):
`faqTopicsContent.js`, `webinarsContent.js`, `podcastEpisodesContent.js`,
`pressReleasesContent.js`.

### Routing
Static pages register in `manifest/content.js` (`CONTENT_ROUTES`; the FAQ topics, `/press`,
`/book-demo` and `/lp/founding-member` are non-draft, the rest `draft: true`), spread into `manifest.js`. Dynamic routes are
registered directly in `routes.jsx` (`/faq/:topicSlug/:questionSlug`, `/webinars/:slug`,
`/webinars/:slug/watch`). `routes.jsx` uses a recursive `./pages/**/*.jsx` glob (keyed by
basename, with a duplicate-name guard) so `pages/faq/*` resolve. The FAQ question pages
are not in the manifest, so their sitemap + prerender entries are enumerated explicitly
(see above); the draft dynamic routes stay off-sitemap.

## Lead-capture forms

Three forms (book-a-demo, webinar registration, podcast-guest) plus the three lead-magnet
forms submit through `components/HubSpotForm.jsx` (name is legacy; HubSpot is decommissioned), a
generic native form that validates required fields and email format, then does a single
`POST` to `LEADS_ENDPOINT` (`lib/marketing/leadsEndpoint.js`, `${API_BASE_URL}/leads`) and fires a
GA4 `generate_lead` event (skipped when the backend answers `duplicate`). No new component pattern
and no new DB table/migration.

- **Registry**: `config/leadForms.js` maps each form key (historically the HubSpot form GUID, now
  an opaque id) → `{ name, source, fields[] }`. `HubSpotForm` looks up the form by `formId`; an
  unknown id renders "Form is not configured yet" instead of silently dropping a lead.
- **The backend owns the writes** (`backend/app/routers/leads.py`): `tool` (= the form `source`)
  routes the row to the `tool_gate_leads` mirror and the Zoho CRM upsert runs from there. The rich
  fields (first/last name, company, phone) go to Zoho; free text (`use_case`, `pitch`) and hidden
  values such as `webinar_slug` are folded into Zoho `description`. The DB mirror stays minimal
  (email + `source` + UTM).
- The webinar form is **one shared form** reused across webinars; the page passes
  `hiddenValues={{ webinar_slug }}` to distinguish them.

| Form | GUID | Page |
|---|---|---|
| Book a Demo | `21747a78-7dbf-b01a-d0b6-a0afa3436cc6` | `/book-demo` |
| Webinar Registration | `082cee0c-492d-96d8-5860-b0ac46cd4a78` | `/webinars/:slug` |
| Podcast — Become a Guest | `61e4bf70-6bc8-8c25-d0f5-fbfdb975fd49` | `/podcast/become-a-guest` |
| Lead Magnet — BRRRR Playbook | `aeddbe22-f85a-84da-13b9-e1ef03278396` | `/lp/brrrr-playbook` |
| Lead Magnet — Flip Checklist | `69d6f339-7ed7-bead-278c-2ab75f1524b0` | `/lp/flip-checklist-guide` |
| Lead Magnet — Wholesaling Guide | `8aabeb9f-69ad-bc56-0420-b87c6a515387` | `/lp/wholesaling-guide` |

The 3 lead-magnet (squeeze-page) forms capture `firstname` + `email` for a free PDF;
the squeeze pages render via `components/SqueezeLayout.jsx`. The PDFs + a delivery
workflow do not exist yet, so the `/lp/*` pages stay draft.

> **Superseded (#888, 2026-07-08 · #1253, 2026-08-05).** This previously read: *"The
> HubSpot/Supabase writes are env-gated (`VITE_HUBSPOT_PORTAL_ID`, `VITE_SUPABASE_WAITLIST_URL`);
> when unset (local dev) the form skips the network write and still shows its success state."*
> HubSpot is decommissioned and the browser-direct Supabase write is gone — its credentials were
> deleted on 2026-08-05. The **silent-success** behaviour is the part worth remembering: a green
> confirmation has never proved a row was written.

## Content integrity

Fabricated content was stripped even though the pages are draft, so no fake claims sit
in the repo as if real:
- `pressReleasesContent.js` lists only verified syndication placements of the launch release
  (`ANNOUNCEMENTS`, exported under the old name `PRESS_RELEASES`); the 4 invented outlet items were
  removed. `PRESS_COVERAGE` (earned coverage) is `[]` and `PressPage` renders an empty state for it.
- The 4 case studies carry an **"Illustrative example"** disclaimer and their fake named
  testimonial attributions were neutralized.

## Publishing a page (later, out of this graft)

1. Final content QA (and for forms, confirm `VITE_API_BASE_URL` points at the target backend so
   `LEADS_ENDPOINT` resolves; there is no HubSpot dependency any more).
2. Remove `draft: true` from the page's `manifest/content.js` entry (dynamic FAQ
   question pages: enumerate `FAQ_QUESTION_PATHS` into the sitemap generator).
3. For published pages, ensure `<SEOHead>` `title`/`description` are **string literals**
   (the `inject-route-meta.mjs` regex only extracts double-quoted literal props) and use
   `schemasForRoute()` for JSON-LD.
4. Wire any published-page footer/nav links through `publishedNav()` so the draft-link
   guard holds.

## Verification

- `frontend/tests/e2e/marketing/graft-draft-surface.spec.ts`, grafted routes render + `noindex` +
  off-sitemap; FAQ JSON-LD; forms render + submit. ⚠ Its `DRAFT_ROUTES` list still contains
  `/press` and `/book-demo`, which were published on 2026-06-22, and its header still describes
  HubSpot GUID/Supabase writes; treat it as stale on those points until it is updated.
- `frontend/tests/features/marketing/leadForms.test.js`, form-key→field wiring (7 tests).
- `frontend/tests/features/marketing/faqPublish.test.js`, FAQ publish state (6 topics, 65 questions).
- Safety gate: the draft pages must add no sitemap entries.

## Related

- [marketing-seo-pages.md](marketing-seo-pages.md) / [seo-surface-implementation.md](seo-surface-implementation.md), the
  post-#683 split-manifest / draft surface this grafts onto.
- [tool-email-gate.md](tool-email-gate.md), the sibling gate the lead forms share plumbing with.
- [lead-intake-system.md](../revops/lead-intake-system.md), `POST /api/v1/leads`.
- `../archive/knowledge-base/facts/hubspot-forms-api-create-quirks.md`, archived: HubSpot
  create-form API gotchas (HubSpot is decommissioned).
