---
title: Marketing Block Library & Design-First Workflow
tier: standard
feature: marketing
domains:
  - features
  - frontend
  - marketing
audience:
  - all
tags:
  - features
  - frontend
  - design-system
  - workflow
status: complete
last_updated: "2026-06-21"
version: "1.0.0"
purpose: Catalog of the 8 approved marketing section blocks, the page archetypes
  they compose into, and the design-first workflow (self-contained HTML preview,
  Claude Design review, then React in the repo).
sources:
  - .design-sync/marketing-blocks/README.md
  - .design-sync/config.json
  - .design-sync/NOTES.md
  - .design-sync/marketing-blocks/nav/index.html
  - frontend/src/config/marketing-theme.js
  - frontend/src/components/shared/MarketingHeader.jsx
  - frontend/src/features/marketing/components/blocks/sections.jsx
  - .claude/rules/tool-registry.md
  - .gitignore
external_refs:
  - finalize_plan
  - write_files
  - register_assets
  - home-mockup-preview.html
last_verified: '2026-11-10'
---

# Marketing Block Library & Design-First Workflow

The marketing surface (homepage + every page under `MarketingLayout`) is built from a small set of
**reusable section blocks** composed into a few **page archetypes**. Blocks are designed in
**Claude Design** first, then shipped to the repo as React. This doc is the catalog + the workflow.

Companion doc: **`marketing-design-system.md`** (tokens, palette, typography, floating header,
accent-CTA convention, footer).

> **Why blocks, not bespoke pages.** A 60+ page SEO surface built page-by-page drifts and reads
> like a content farm. A block vocabulary keeps every page visually consistent and on-brand;
> uniqueness comes from *which blocks, in what order, with what art* — not from duplicated layout
> code.

---

## Where things live

| Thing | Location |
|-------|----------|
| Design-system project (review surface) | **Claude Design** → project **Acme UI** (`7a2861e7-0aff-66ab-6ece-a9a84f61d166`) |
| Local block sources (self-contained HTML previews) | `.design-sync/marketing-blocks/<slug>/index.html` |
| Sync config + conventions | `.design-sync/config.json`, `.design-sync/conventions.md`, `.design-sync/NOTES.md` |
| Shipped React (target) | `frontend/src/components/shared/` (`MarketingHeader.jsx`, `MarketingFooter.jsx`), `frontend/src/features/marketing/components/blocks/sections.jsx` (page blocks: `Hero`, `StatBand`, `ValueRows`, `Testimonial`, `FaqAccordion`, `CtaBand`) |
| Design tokens | `frontend/src/config/marketing-theme.js` (`--blue`, `--accent` `#E8943A`). Fonts: `marketingFonts` there declares Inter + JetBrains Mono, while the blocks and the mobile menu use Sora through `--mkt-font-display` (Sora is loaded statically; see the comment at `frontend/src/features/home/components/Home.jsx:405`) |

---

## Block catalog (8 approved)

All are branded in the marketing tokens, use Sora + JetBrains-Mono-for-numbers, and avoid em-dashes
in copy (house style). Each is a self-contained HTML preview card in Claude Design under
**Marketing / Blocks**.

| Block | What it is | Notable detail |
|-------|-----------|----------------|
| **TopNav** | Floating frosted island header | translucent + `backdrop-filter` blur, fill 42% at the top and 35% once scrolled (`.ih-nav.scrolled` in `MarketingHeader.jsx`), Login ghost + Get Started orange pill. See `marketing-design-system.md` § Floating header |
| **HeroVisual** | Split hero: copy left, product media right | media = branded map (CartoDB/OSM-rendered) with floating deal cards + score ring; mesh-gradient background |
| **FeatureRows** | Alternating text ↔ media zigzag | media uses **real app screenshots** (e.g. the Deal Analyzer in a browser frame) + branded UI mocks (pipeline kanban, Sam chat with the real `sid.png` avatar, `frontend/src/assets/images/coaches/sid.png`) |
| **StatBand** | 4 big social-proof numbers | gradient numerals on a soft brand band |
| **Testimonial** | Featured customer quote | stars, gradient-highlighted phrase, avatar + name/role |
| **CardGrid** | 3-up image cards (case studies) | real property photos, category tag, green mono metric pill, balanced 2-line titles (`text-wrap:balance`) |
| **CtaBand** | Full-width brand-gradient closer | "Ready to find your next deal?" + Get Started / Book a demo |
| **Footer** | Deep-navy shared footer | white logo, socials, 4 link columns, legal bar, disclaimer (= `MarketingFooter`) |

---

## Page archetypes (compose blocks)

A typical landing/Detail page stacks:

```
TopNav → HeroVisual → StatBand → FeatureRows → Testimonial → CardGrid → CtaBand → Footer
```

The ~9 archetypes that cover the whole surface: **Detail / SEO landing, Hub / index, Tool landing,
Tool app (gated), Comparison, FAQ / knowledge, Article / case study, Media (webinar/podcast),
Form / conversion.** Two pages stay bespoke: **Home** and **Pricing**.

> Full surface map + the route inventory live in `marketing/seo-geo-surface-route-map.md`. (The
> planning workspace this note used to name is not in a current checkout.)

---

## The design-first workflow

1. **Gather references.** Use the local **crw** scraper (Firecrawl-compatible, `http://localhost:3003/v1/scrape`;
   nothing listens on 3002 any more; renders JS SPAs that `WebFetch` can't) and **SearXNG** (`http://localhost:8888/search?format=json`)
   to pull layout patterns from best-in-class sites. (Registered in `.claude/rules/tool-registry.md`.)
2. **Brand it.** Rebuild the reference layout in our tokens as a **self-contained HTML preview**
   under `.design-sync/marketing-blocks/<slug>/index.html` (inline `<style>` with the brand tokens;
   base64-inline images so the file is self-contained, keep it under ~256 KB).
3. **Real assets, not lorem.** Property photos, the `sid.png` coach avatar, real app screenshots.
   App screenshots: headless-login (`user@example.com`) via Playwright, crop with **ImageMagick**
   (`convert`), then base64-inline.
4. **Self-render to verify.** Headless Chromium screenshot → view before pushing (don't push blind).
5. **Push to Claude Design.** `DesignSync` tool: `finalize_plan` → `write_files` →
   `register_assets` (path `components/marketing/<Name>/<Name>.html`, group "Marketing / Blocks").
   These hand-authored cards are **review artifacts** — Phase 3 replaces them with real React
   components + Storybook stories on the established `.design-sync` (Storybook-shaped) pipeline.
6. **Review live.** Copy the preview to `frontend/public/<slug>-preview.html` and open at
   `http://localhost/<slug>-preview.html` (Playwright) so the user reacts to the real thing.
7. **Iterate → approve → ship to repo.**

> Full-page assembly for review (`frontend/public/landing-page-preview.html`,
> `frontend/public/home-mockup-preview.html`; gitignored serving copies of
> `.design-sync/marketing-blocks/_assembled/{landing-page,home-mockup}.html`) stitches blocks as auto-sized iframes; the floating nav is inlined in
> the parent document so `backdrop-filter` actually frosts the content behind it (it can't blur
> across an iframe boundary). These assembled pages are **localhost-only** review artifacts, not DS
> cards.

---

## How to add a new block

1. Author `.design-sync/marketing-blocks/<slug>/index.html` (self-contained, brand tokens, no
   em-dashes, real assets base64-inlined).
2. Self-render (headless Chromium) and eyeball it.
3. Push + register via `DesignSync` to the **Acme UI** project under "Marketing / Blocks".
4. Serve a copy from `frontend/public/` for live review at `http://localhost`.
5. On approval, implement as a React component in `frontend/src/features/marketing/` (or
   `frontend/src/components/shared/` for frame pieces), wired to the marketing tokens, and validate in-browser.

## Related

- `marketing-design-system.md` — tokens, palette, floating header, accent CTA, footer.
- `marketing-scaffolding-guide.md` — manifest-driven page routing + sitemap regen.
- `marketing/seo-geo-surface-route-map.md` — the canonical route inventory.
