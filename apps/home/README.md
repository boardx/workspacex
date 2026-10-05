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
node scripts/check-all.mjs                 # everything, ~110s
node scripts/check-all.mjs --static-only   # just the text gates, ~2s
```

The static gates need nothing installed. The browser suites need Playwright and
axe-core, and **skip themselves with a message when those are absent** rather
than failing, so this stays runnable on a bare checkout:

```bash
npm i --no-save playwright axe-core
CHROMIUM_PATH=/path/to/chrome node scripts/check-all.mjs
```

| script | what it fails on |
|---|---|
| `check-i18n.mjs` | a key used but untranslated, translated but unused, translated to whitespace, containing Cyrillic, left in English, or defined but not applied in the built Chinese page |
| `check-html.mjs` | flow content inside a button, nested anchors, duplicate ids, skipped heading levels, `aria-labelledby` pointing at nothing, images without alt |
| `check-links.mjs` | a local `href`/`src`/card image that resolves to no file, a fragment with no matching id, a `_redirects` target that is not there, a sitemap `<loc>` that is not there or a page missing from the sitemap, a self-referential URL that disagrees with `SITE`, a social card with no alt text, an `og:locale` that is not `language_TERRITORY`, or an `hreflang` written with an underscore |
| `check-css.mjs` | a `:hover` rule outside `@media (hover: hover)`, a letter-spacing that does not scale with the page language, a class or custom property defined and never used, a `var()` reading a property nothing declares, a brand colour written literally outside the token block, a value off the radius or type scale, a `--bp-*` token no media query uses, or a font stack with no CJK face for one of the four platforms |
| `check-copy.mjs` | straight quotes and apostrophes, half-width punctuation between Han characters, missing CJK/latin spacing, `...` instead of `……` |
| `check-compat.mjs` | a feature with known engine gaps used without its guard |
| `check-citations.mjs` | a report quoted on the page that is not in `docs/sources/index.json` word for word, or shown with a firm, title, date, URL or page the register does not hold; a quote that differs between languages or lacks its Chinese translation; a malformed register entry. `--self-test` proves each rule can fail. The register is written only by `scripts/add-source.py`, which finds each sentence in the report's own file — see `docs/sources/README.md` |
| `check-sequence.mjs` | a section eyebrow whose number disagrees with the document order, in either language, or the privacy page's prose changing without its "Last updated" date |
| `check-deploy.mjs` | `_headers` malformed, missing a site-wide header or a CSP directive, `script-src` gaining `'unsafe-inline'`, a rule matching no file, or `security.txt` expired, expiring within 30 days, or dated more than a year out |
| `build-css.mjs --check` | `site.css` out of date with its sources |
| `build-js.mjs --check` | `site.js` out of date with its modules, or a module the bundler cannot join safely (a cycle, an unsupported import, one top-level name declared in two modules) |
| `build-i18n.mjs --check` | a generated page, `sitemap.xml` or `robots.txt` out of date with its sources |
| `build-brand.mjs --check` | a manifest out of date with its page's title and description or the token block |
| `check-assets.mjs` | a generated binary — either social card, the logo, the favicon, the touch icon, the aurora — older than the sources it came from, including the product's own logo and icon in `apps/web/public` |
| `check-docs.mjs` | this README's tables disagreeing with the scripts on disk or the suites that run |
| `check-all.mjs` | **a `check-*.mjs` that exists and nothing runs** |
| `tests/browser.test.mjs` | axe violations, unreachable controls, layout breaking at any of 11 widths, the interactions, the no-JS path, the Chinese page, the pre-Safari-14 path, a selected state invisible in forced colors, a handler or observer accumulating across re-wires, a missing or unenforced security header |
| `tests/manual.test.mjs` | missing homepage entry, broken manual anchors, overflow, WCAG violations, print controls visible in PDF, or missing no-JS content |
| `tests/demo.test.mjs` | the scripted demo, both languages, driven like a visitor: fetched before the reader did anything, a scenario, step or claim missing, a withdrawn claim not struck through, a check open before anyone asked, "Doubt this" not quoting and lighting exactly the claim's sources, the withdrawn claim not opening by itself, a reader's decision to put it back not followed by every label on screen, a copied note missing the answer, the decision or the sample label, a sign-up button that says something different from the hero's, axe violations in the mounted demo, a double-started run, a touch target under 44×44 on a phone |
| `tests/perf.test.mjs` | transfer, LCP, CLS or frame time over budget, in **both** languages |
| `tests/webkit.test.mjs` | in **Safari's engine** (WebKit), both languages, on an iPhone and a Mac-sized window: a script error, a diagram not drawn, sideways scroll, content left invisible after scrolling, or a menu that does not open and close. Saves full-page screenshots to `test-results/webkit/`, which CI uploads. Skips itself where WebKit is not installed |
| `tests/eval/eval.mjs` | the acceptance score below **9 / 10** in either language — see *Acceptance eval* below |

`tests/browser.test.mjs` is one row in that table and twenty-three suites in
practice. Most run once per language, because four of them ran against English
only for twenty rounds and the Chinese page is a separately generated document:

| Suite | What it would catch |
|---|---|
| accessibility | axe-core over five pages in two languages |
| keyboard ×2 | a control that cannot be reached, has no focus indicator, or can be clicked but not operated |
| responsive | sideways overflow, svg text under 9px, or nav items overlapping each other, at 11 widths |
| mobile ×2 | on three emulated phones with touch and a coarse pointer: sideways scroll, a touch target under 44×44, text under 12px, or a menu that does not open, lock the page, close and navigate. Chromium only — not WebKit |
| text resize ×2 | content pushed off screen at a 200% text setting (WCAG 1.4.4) |
| interaction ×2 | the compare switch, the architecture explorer or the discipline tabs failing to change state |
| degradation ×2 | the page going blank without JavaScript, or when one module fails |
| resilience | a missing stylesheet, font, image or script; a light-scheme visitor; forced colors; a phone held sideways |
| motion | the rAF layer not running at all — reveals, reading progress, `--dscale`, untranslated diagram labels |
| bilingual | the Chinese page not standing on its own |
| addressable ×2 | a discipline that cannot be linked to, or a tab click growing the history |
| console | anything logged, thrown or 404ing across five pages |
| headers | a security header missing, or a CSP that is sent and not enforced |
| accumulation | a handler, observer or node that survives a re-wire and stacks up |
| forced colors | a selected state indistinguishable from an unselected one in Windows high contrast |
| compatibility ×2 | a `MediaQueryList` without `addEventListener` |

### The deployed site

```bash
node scripts/live-check.mjs      # asks production: pages, redirects (loops), headers, sitemap
```

Not part of `check-all` — it needs the network and a deployment. It runs daily
and on demand in `.github/workflows/home-live.yml`. The repository can say
what `_redirects` and `_headers` intend; only the host can say what happens.

### Acceptance eval

```bash
node tests/eval/eval.mjs                          # the score card
node tests/eval/eval.mjs --record --label "…"     # also append to docs/eval/history.json
node tests/eval/eval.mjs --min 9                  # exit 1 below 9 (what check-all runs)
```

Seventy-seven cases in ten dimensions — first screen, navigation, accessibility,
performance, mobile, bilingual, brand, search and sharing, conversion,
readability — one point per dimension. **Every case runs against `/` and
`/zh/`, and the score is the lower of the two**: a site that is excellent in
English and mediocre in Chinese is mediocre for half its readers. Graded cases
(LCP, weight, sentence length…) score linearly between a full-marks and a
zero threshold written next to them. `docs/eval/history.json` is the score of
every round, so a change that makes the site worse shows up as a number.

It measures what its cases measure. It cannot tell whether the argument
persuades or whether the page looks right in Safari; it is the floor a change
must not go below.

**Expectations in the browser suite are derived from the source, not typed in.**
The version of it that lived outside this repository went stale four separate
times by asserting against counts that had since changed — and the first run of
the derived version immediately found a diagram host that had rendered nothing
since the site was built.

Two generators are run by hand, not by the checks, because they need
Playwright. Both are still *checked*, by fingerprinting their sources:

```bash
node scripts/build-og.mjs        # social cards, from og-card.html
node scripts/build-aurora.mjs    # the hero backdrop, from the gradient tokens
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
privacy.html               the privacy note (English; zh/ version generated)
assets/css/site.css        the shipped bundle (GENERATED from the seven below)
assets/css/fonts.css       self-hosted variable Outfit + Inter (latin only)
assets/fonts/inter-*.woff2 Inter cut to weight 400–700 (GENERATED from scripts/fonts-src/)
assets/css/base.css        tokens, reset, type scale
assets/css/layout.css      shell, nav, section rhythm, footer
assets/css/components.css  buttons, cards, stages, rails
assets/css/sections.css    per-section layout
assets/css/motion.css      reveals, hero, sticky scenes, reduced-motion contract
assets/css/diagrams.css    SVG styling
assets/css/print.css       the printed page
assets/js/site.js          the shipped script (GENERATED from the modules below by build-js)
assets/js/main.js          wiring
assets/js/mq.js            reads the --bp-* tokens so JS and CSS share one number
assets/js/compare.js       the before / after switch
assets/js/cases.js         the discipline tabs, addressable by fragment
assets/js/demo.js          the scripted demo: four scenarios in both languages, loaded on demand (not in site.js)
assets/js/surface.js       the workspace illustration
assets/js/lang.js          reports the page language; offers the other one
assets/js/zh.js            Chinese page copy
assets/js/diagram-strings.js  bilingual diagram labels
assets/js/motion.js        IntersectionObserver reveals, nav, scroll scenes
assets/js/diagrams.js      the seven concept illustrations
assets/img/og.jpg          social card (generated)
assets/img/og-zh.jpg       Chinese social card (generated)
assets/img/apple-touch-icon.png  home screen (GENERATED from apps/web/public/apple-icon.png)
assets/site.webmanifest    name, icons, theme (generated)
zh/index.html              Chinese page (GENERATED — do not edit)
assets/img/favicon.png     browser tab (GENERATED from apps/web/public/apple-icon.png)
assets/site.zh.webmanifest Chinese name, icons, theme (generated)
404.html  robots.txt  sitemap.xml  _headers  _redirects
.well-known/security.txt   the security contact, with an expiry that is checked
scripts/                   the checks above, plus the generators
tests/                     the browser and performance suites, and their harness
scripts/og-card.html       source for the social cards
scripts/fonts-src/         Inter as it came from upstream, full 100–900 axis
docs/eval/history.json     the acceptance score of every round
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

Latin only. CJK falls back to the system face — what Chinese readers expect,
and it avoids shipping several megabytes of webfont.

The fallback tail lives in `--font-display` and `--font-body` in `base.css` and
is not decoration: it is what resolves **every Han character on `/zh/`**. This
paragraph used to name Microsoft YaHei for Windows while the stylesheet did
not, so a Chinese reader on Windows fell through to `sans-serif`, which there
is SimSun — a serif. The documentation was right and the code was wrong for
thirty-eight rounds because nobody compared them. `check-css.mjs` now requires
a face for macOS/iOS, older macOS, Windows and Linux/Android, so the stack can
no longer quietly lose a platform.

## Production deployment

The target production domain is `https://workspacex.us`, on the existing
Cloudflare Pages Direct Upload project `workspacex-home` in BoardX Inc.
`workspacex-home.pages.dev` remains its default domain. The authorized owner must
attach and verify `workspacex.us` before this change is published.
The project has no native Git connection. GitHub Actions can publish to this
same project through Wrangler without migrating it.

`.github/workflows/deploy-home.yml` validates PRs but publishes only a push to
`main` touching the home site, its two product-brand image inputs, LICENSE,
SECURITY.md, the deployment workflow or the Node version. Non-main pushes and
unrelated monorepo changes do not publish. Production runs are serialized;
a new push never cancels an in-progress cutover.

Static gates and the deployment failure/rollback contracts must pass first.
The publisher checks out the event SHA, packages only runtime files, and adds
`/.well-known/workspacex-release.json` with that exact commit. Wrangler uses
`--project-name workspacex-home --branch main --commit-hash <event SHA>`.
The source canonical, hreflang, social URLs, security.txt and generated sitemap
use the new apex domain; a temporary deploy-time substitution is unnecessary.

The existing Actions secret names are `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN`. The account ID must be BoardX Inc's
`cc39c0447db8c730182cfd075fe91bf7`; the existing token needs Account / Cloudflare
Pages / Edit for that account. No token values belong in source, logs or issues.
If the existing secret is unavailable or lacks that scope, an authorized owner
must set it through GitHub Settings → Secrets and variables → Actions. Do not
copy a local env token through a new client or create wider permissions.

Before publishing, the workflow checks the existing project name, main branch,
new apex domain and successful current production deployment. It records the previous
ID, then verifies routes, headers and the public release SHA at both the immutable
deployment URL and custom domain. Verification failure stops the run and rolls
back only its own cutover; another publisher's deployment is never reversed.
No deployment is deleted. The run summary and retained `home-deployment-<SHA>`
artifact hold new/previous IDs, deployment URL, timestamps and verification status.
For manual recovery, choose the previous successful production deployment in the
Pages Dashboard and use its rollback action.

Official references: [Direct Upload with CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
and [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/).
Merging this workflow is not proof that automation is working. Confirm a real
main push, successful deploy job, matching Pages commit and public release marker.

## Other launch configuration

**2. The product link.** "Launch App" and "Launch Workspace" point at
`https://devapp.boardx.us`, the only app host referenced anywhere in this
repository. If the public site should send people somewhere else, change it.

**3. The ICP filing notice.** A site served from mainland China must display
its ICP record number in the footer. There is no number in this repository and
none has been invented. If `/zh/` is going to be served from inside China, add
it to `footer.copy` in `assets/js/zh.js` and regenerate. If the Chinese pages
are served from outside China, this does not apply.

## Build steps

Six generators. None is needed to *serve* the site — every output is
committed — but all three are checked, so a stale one cannot ship.

```bash
node scripts/build-css.mjs      # assets/css/*.css  -> assets/css/site.css
node scripts/build-js.mjs       # assets/js/*.js (from main.js) -> assets/js/site.js
node scripts/build-i18n.mjs     # index/privacy + zh.js -> zh/*.html, sitemap.xml, robots.txt
node scripts/build-brand.mjs    # page titles + base.css -> manifests
node scripts/build-og.mjs       # og-card.html + logo.webp -> assets/img/og*.jpg (needs playwright)
node scripts/check-assets.mjs --update   # after either builder above, record the new sources
node scripts/build-aurora.mjs   # inline gradients  -> assets/img/aurora.webp (needs playwright)
node scripts/build-fonts.mjs    # scripts/fonts-src/inter-*.woff2 -> assets/fonts/, weight axis cut to 400–700 (needs fonttools)
node scripts/build-logo.mjs     # apps/web/public/{workspacex-logo,apple-icon}.png -> logo.webp, favicon.png, apple-touch-icon.png (needs playwright)
```

The stylesheets are authored split by concern and shipped as one file: seven
render-blocking requests on a high-latency link meant nothing painted for
6.2 seconds. The bundler also strips comments, which are written for whoever
edits the source and have no reason to travel to a browser. It prints both
sizes when it runs, which is the only place those numbers should live — the
pair quoted here went 16% stale without anyone noticing.

## User manual

`manual/index.html` is the single Chinese content source for `/manual/` and
browser-print PDF. Both homepages link to it; no English translation is claimed.
`manual/style.css` and `manual/print.css` provide the responsive layout and A4
print layout. `manual/manual.js` only invokes the browser print dialog.

Content revision 0.1 (2026-10-03) is a first user-facing guide, not a claim that
every product behavior passed runtime acceptance. The source draft references
`docs/testing/user-test-manual.md`, `apps/web/app/{page,home/page}.tsx`,
`docs/deployment/{LOCAL-DESKTOP,BOARD}.md`, and
`packages/local-runtime/src/capabilities.ts`; its original snapshot was
814dc05a36e1f2645b7528b9dacc0a344ec615ae. Runtime screenshots must record the
actual deployment SHA, date and viewport before addition. No simulated
screenshots or invented support address are included.

The manual is included in Pages runtime packaging and the generated sitemap.
HTML structure and link checks include the new source page. To export the same
body, open `/manual/`, choose Print / Save as PDF, and select A4. Browser page
numbering is an optional print setting. PDF files are derived deliverables;
never maintain a separate PDF manuscript.

## Landing-page domain cutover (prepared locally, not deployed)

Only the public website moves from `www.boardx.us` / `boardx.us` to
`https://workspacex.us`. Start free continues to open `devapp.boardx.us`;
`develop.boardx.us`, application APIs, OAuth and all email/MX records are unchanged.
The Organization remains BoardX; its website URL and structured-data identifier
now use the website origin.

Deployment order for the authorized owner:

1. Record the current successful Pages deployment ID and existing website DNS / redirect
   settings. Attach `workspacex.us` to the existing `workspacex-home` Pages project,
   verify TLS and custom-domain readiness. Do not change MX or application domains.
2. Merge this change only when ready to publish: a home-related push to `main`
   triggers `deploy-home`. Direct Upload has no native Git binding. The publisher
   refuses to run unless the project includes `workspacex.us`, and verifies the exact
   release SHA plus routes / headers on the deployment URL and new custom domain.
3. After the new domain passes verification, configure a temporary 302 redirect
   on the old website hosts only; validate it in the browser before changing it
   to permanent 301. Use a Cloudflare Single Redirect expression matching
   `(http.host eq "boardx.us") or (http.host eq "www.boardx.us")`, dynamic destination
   `concat("https://workspacex.us", http.request.uri.path)`, status 302 then 301 and
   **Preserve query string** enabled. Keep old-host DNS/TLS capable of serving that
   redirect; never match `*.boardx.us`. Pages `_redirects` does not support
   domain-level redirects:
   <https://developers.cloudflare.com/pages/configuration/redirects/>.
4. Run `node apps/home/scripts/live-check.mjs` for the new origin, then, once the
   old-host redirect has been made permanent,
   `node apps/home/scripts/verify-domain-redirects.mjs` for both old hosts, including
   nested paths and encoded queries. Check Start free, mail links and canonical /
   hreflang / sitemap in the browser. The ordinary live check deliberately still
   fails directly linked URLs that redirect; use the dedicated domain verifier
   for old hosts. No live checks are claimed by local fixture tests.

Rollback: disable/revert the old-host redirect first, then restore the previous
successful Pages deployment using the retained deployment ID and restore only
website DNS/custom-domain settings changed for the cutover. A pre-migration
artifact has the old canonical and deployment guard; revert this code commit
before a subsequent `main` publication. Recheck both domains, Start free and
security/privacy links. The existing publisher automatically rolls back only
its own failed deployment and never another publisher's deployment.

Local verification:

```bash
node apps/home/scripts/check-all.mjs --static-only
node --test apps/home/tests/pages-deploy.test.mjs
```

The deployment fixtures exercise domain mismatch refusal, public-SHA verification,
rollback ownership, same-path cross-origin redirects, real loops, hop limits,
path/query preservation and temporary-redirect rejection without contacting Cloudflare.
