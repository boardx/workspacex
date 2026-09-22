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
node scripts/check-all.mjs       # everything below; must pass before commit
```

| script | what it fails on |
|---|---|
| `check-i18n.mjs` | a key used but untranslated, translated but unused, translated to whitespace, containing Cyrillic, or left in English |
| `check-html.mjs` | flow content inside a button, nested anchors, duplicate ids, skipped heading levels, `href="#…"` or `aria-labelledby` pointing at nothing |
| `check-css.mjs` | a class or custom property defined and never used, or a `var()` reading a property nothing declares |
| `check-copy.mjs` | straight quotes and apostrophes, half-width punctuation between Han characters, missing CJK/latin spacing, `...` instead of `……` |
| `build-i18n.mjs --check` | `zh/index.html` out of date with `index.html` + `zh.js` |

Two generators are run by hand, not by the checks, because they need
Playwright:

```bash
node scripts/build-og.mjs        # regenerates the social cards from og-card.html
```

## How the two languages work

**Language is a URL, not runtime state.**

    /       English    index.html      authored by hand
    /zh/    Chinese    zh/index.html   GENERATED — do not edit

English is authored inline in `index.html` against `data-i18n` keys, so the
markup is complete without JavaScript — see `motion.css` for the two guarantees
that keep it readable when scripting is off or a script fails to load.
`assets/js/zh.js` holds the Chinese for every key, and
`scripts/build-i18n.mjs` prerenders `zh/index.html` from the two. There is no
second copy of the English anywhere, and no text is swapped at runtime.

That matters: with client-side switching the Chinese site had one URL, English
in the markup, and no way to link anyone to it. It was unindexable and
unshareable. Now each language is a real page with its own canonical URL,
`hreflang` alternates, title, description and social card.

After editing `index.html` or `zh.js`, regenerate:

```bash
node scripts/build-i18n.mjs
```

`check-all.mjs` fails if you forget — it re-generates in memory and compares.

Diagram labels are the exception to the dictionary split: JS draws them, so
there is no DOM to author them in. Both languages sit together in
`assets/js/diagram-strings.js`.

A visitor whose browser prefers the other language gets a dismissible offer
(`lang.js`), never an automatic redirect — redirecting breaks the back button,
hides one language from crawlers, and overrides a deliberate choice.

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
assets/js/lang.js          reports the page language; offers the other one
assets/js/zh.js            Chinese page copy
assets/js/diagram-strings.js  bilingual diagram labels
assets/js/motion.js        IntersectionObserver reveals, nav, scroll scenes
assets/js/diagrams.js      the seven concept illustrations
assets/img/og.png          social card (generated)
assets/img/og-zh.png       Chinese social card (generated)
zh/index.html              Chinese page (GENERATED — do not edit)
404.html  robots.txt  sitemap.xml  _headers
scripts/                   the checks above, plus the two generators
scripts/og-card.html       source for the social cards
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

## Before this goes live — two things to set

Both are placeholders I could not resolve from the repository. They are wrong
until someone who knows the answer changes them.

**1. The public domain.** Every absolute URL currently says
`https://workspacex.boardx.us`. That domain is a guess. It appears in:

- `index.html` — `canonical`, three `hreflang` links, `og:url`, `og:image`,
  `twitter:image`
- `scripts/build-i18n.mjs` — the `SITE` constant, which rewrites those for `/zh/`
- `sitemap.xml`, `robots.txt`

Change `SITE` in `build-i18n.mjs` and the same string in `index.html`, then run
`node scripts/build-i18n.mjs`. Getting this wrong means canonical tags pointing
at a domain that does not exist and social cards that never load.

**2. The product link.** "Launch App" and "Launch Workspace" point at
`https://devapp.boardx.us`, the only app host referenced anywhere in this
repository. If the public site should send people somewhere else, change it.

**3. The ICP filing notice.** A site served from mainland China must display
its ICP record number in the footer. There is no number in this repository and
none has been invented. If `/zh/` is going to be served from inside China, add
it to `footer.copy` in `assets/js/zh.js` and regenerate. If the Chinese pages
are served from outside China, this does not apply.

## Build steps

Three generators. None is needed to *serve* the site — every output is
committed — but all three are checked, so a stale one cannot ship.

```bash
node scripts/build-css.mjs      # assets/css/*.css  -> assets/css/site.css
node scripts/build-i18n.mjs     # index/privacy + zh.js -> zh/*.html
node scripts/build-og.mjs       # og-card.html      -> assets/img/og*.png   (needs playwright)
node scripts/build-aurora.mjs   # inline gradients  -> assets/img/aurora.jpg (needs playwright)
```

The stylesheets are authored split by concern and shipped as one file: six
render-blocking requests on a high-latency link meant nothing painted for
6.2 seconds. The bundler also strips comments, which are written for whoever
edits the source and have no reason to travel to a browser — 74 KB of sources
become 52 KB shipped, 11 KB over the wire.
