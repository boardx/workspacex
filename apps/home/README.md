# apps/home — WorkspaceX marketing site

The public site at the root domain. Content is derived from the WorkspaceX
pitch deck (2026.09), translated from investor framing into product framing.

## Why there is no build step

Zero dependencies, zero build. Plain HTML, CSS and ES modules, served as files.

That is a deliberate choice, not a shortcut:

- It stays out of the monorepo's `pnpm-workspace.yaml` (no `package.json`), so
  it can never churn the root lockfile or add a turbo task to `verify:base`.
- Cloudflare Pages deploys the directory directly — no build command, no
  `dist/`, nothing to go stale between source and what is live. The previous
  `apps/home` was a `dist/` with no source anywhere; this cannot repeat.
- The animations are hand-written SVG and CSS. A framework would add weight
  without doing any of that work for us.

If this ever needs a framework, add one then. Not before.

## Run it

```bash
cd apps/home
python3 -m http.server 4310      # or any static server
```

Open <http://127.0.0.1:4310>.

## Check it

```bash
node scripts/check-i18n.mjs      # EN/ZH key parity — must pass before commit
```

## How the two languages work

English is authored inline in `index.html`, so the page is complete and
indexable with JavaScript disabled. `assets/js/zh.js` supplies Chinese for every
`data-i18n` key; switching swaps `textContent` and sets `lang`. There is no
second copy of the English anywhere.

Diagram labels are the exception: JS draws them, so there is no DOM to author
them in. Both languages sit together in `assets/js/diagram-strings.js`.

`scripts/check-i18n.mjs` is the gate over both. A key used but untranslated,
translated but unused, or translated to whitespace fails the check.

## Layout

```
index.html                 all page copy (English) + structure
assets/css/fonts.css       self-hosted variable Outfit + Inter (latin only)
assets/css/base.css        tokens, reset, type scale
assets/css/layout.css      shell, nav, section rhythm, footer
assets/css/components.css  buttons, cards, stages, rails
assets/css/sections.css    per-section layout
assets/css/motion.css      reveals, hero, sticky scenes, reduced-motion contract
assets/css/diagrams.css    SVG styling
assets/js/main.js          wiring
assets/js/i18n.js          language switching
assets/js/zh.js            Chinese page copy
assets/js/diagram-strings.js  bilingual diagram labels
assets/js/motion.js        IntersectionObserver reveals, nav, scroll scenes
assets/js/diagrams.js      the seven concept illustrations
scripts/check-i18n.mjs     translation completeness gate
docs/REVIEW-LOG.md         what each iteration round found and changed
```

## Content scope

The deck's market sizing, competitive positioning map, business model and
go-to-market are investor material — the deck labels those figures internal
scenario models rather than third-party forecasts. They are deliberately not on
the public site. What is here is the product argument: the shift, the problem,
the loop, the three scales, the architecture, trust, where to start, and the
open-core stance.

## Fonts

Latin only. CJK falls back to the system face (PingFang SC on macOS, Microsoft
YaHei on Windows, Noto Sans SC on Linux) — what Chinese readers expect, and it
avoids shipping several megabytes of webfont.
