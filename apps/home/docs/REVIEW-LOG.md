# apps/home — iteration log

Ten rounds. Each round: find ten concrete gaps in usability, professionalism,
content or accessibility, fix them, re-verify with real browser captures.

Verification harness lives outside the repo (scratchpad) and drives headless
Chromium against `python3 -m http.server`. Layout captures run with
`reducedMotion: 'reduce'` so every reveal has landed — a capture mid-transition
shows a blank section and lies about the layout. A separate `MOTION=on` pass
exercises the animated path.

---

## Round 1 — baseline build

The page did not exist in source form: `apps/home` on the author's machine held
only `dist/` and `node_modules`, and nothing had ever been committed. This round
is the rebuild plus the first review pass over it.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Fonts loaded from the Google CDN — a third-party request on every visit, invisible text when the CDN is slow or blocked, and visitor IPs handed to a font host. | Self-hosted Outfit + Inter as variable woff2. Google serves one variable file per family+subset but declares it three times; deduplicating cut 592 KB to 184 KB. `preload` on the two latin files. |
| 2 | CJK inherited the latin `-0.04em` tracking, which collides Chinese glyphs, and the 1.6 body leading is too tight for Hanzi. | `:lang(zh)` overrides tracking to `-0.01em` and leading to 1.75. |
| 3 | Hero headline at `6.25rem` filled the whole first viewport; the chain diagram — the one thing that shows what the product *is* — sat below the fold. | Scale down to `clamp(2.5rem, 6vw, 5rem)`. Chain is now visible on a 1440×900 screen. |
| 4 | Reveals used a 900 ms transition and a `0.08` threshold with a `-12%` bottom margin. A fast scroller outran them and landed on blank sections — confirmed in capture, where whole sections rendered empty. | 620 ms, `threshold: 0`, `-4%` margin, plus an explicit first-paint check so anything already on screen is revealed immediately instead of waiting for a scroll event that may never arrive. |
| 5 | The loop scene reserved `420vh` — 4 789 px of scrolling for one diagram, far out of proportion to the rest of the page. | `300vh`. |
| 6 | Nothing stopped English and Chinese from drifting apart; a missing key would have rendered as a blank element in production. | `scripts/check-i18n.mjs`: fails on keys used but untranslated, translated but unused, or translated to whitespace. Currently green at 149 keys. |
| 7 | Diagram labels are drawn by JS and had no translation path at all — they would have stayed English on the Chinese page. | `diagram-strings.js` holds both languages side by side; diagrams re-render on `langchange`; the same check covers them. |
| 8 | The broken-chain diagram used a 220-unit viewBox with content only in the middle band, and repeated "context lost" four times. | 150-unit box, one centred label. |
| 9 | Diagram boxes at `rgba(255,255,255,.035)` on the dark stage were effectively invisible. | Raised to `.07` fill / `.22` stroke. |
| 10 | Architecture bracket labels were rotated 90°, 11 px and dim — unreadable. | Horizontal, placed in a widened viewBox with room reserved for them. |

Also fixed while verifying: the harness token parked on top of the "Evidence"
gate label under reduced motion, hiding it.

---

## Round 2 — content: what a visitor actually needs to know

Round 1 produced a well-built page that argued a thesis. A visitor deciding
whether to care still could not see the product, could not get an answer to the
questions that decide deployability, and had no idea what stage any of this is
at. That is a content failure, not a craft one.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The site never showed the product. Eleven sections of argument and not one picture of the thing. | New **The Workspace** section: a working surface built in HTML/CSS — agent roster, shared canvas with decision / open-question / draft notes, and the evidence trail beside it. The evidence column is the differentiator, so it gets its own column. |
| 2 | Its connector lines were hand-authored in a `0 0 400 260` viewBox stretched with `preserveAspectRatio="none"` over a fluid container — they pointed at nothing at any width but the one they were drawn for. | `surface.js` measures the real note boxes and redraws the curves, on load, on `fonts.ready` (font swap changes note heights), on resize and on language change. |
| 3 | Nothing addressed the questions that actually decide whether a company can deploy this: where data lives, what happens when models change, how an agent is prevented from overstepping, whether existing tools get replaced, whether it is open, what stage it is at. | New **Straight answers** section, six items, written as answers rather than as reassurance. |
| 4 | No economic framing. "Use AI" is not something anyone can buy; the deck's MAAU concept is the answer and was missing entirely. | New **The unit of work** section: the six-part anatomy, plus the four properties that make a unit deliverable, verifiable, reusable and priceable. |
| 5 | No forward story — a reader had no idea whether this is a product to buy today or a direction. | New **Horizons** section, three steps, with "now" visually distinguished from "next" and "then". |
| 6 | Navigation listed five anchors for what had become twelve sections, and the new workspace section was unreachable from the nav. | Added the anchor; nav now covers the six sections a first-time reader most needs. |
| 7 | Inserting sections broke the numbered eyebrows — two `04`s and two `08`s. | Renumbering is now derived from DOM order by script and applied to both languages, so it cannot drift again by hand. |
| 8 | Three Cyrillic words had slipped into the Chinese copy while typing it (`работе`, `случай`, `produce`). Invisible in review of a 228-key dictionary. | Fixed, and `check-i18n.mjs` now fails on any Cyrillic in a Chinese value. |
| 9 | A key copied over but never translated would have passed every check. | The gate now flags Chinese values with latin letters and no Han characters, with an explicit exemption list for brand names. |
| 10 | The workspace illustration is three columns; at phone width that is three unreadable slivers. | Under 900 px the roster is dropped — it repeats what the canvas already shows — and the canvas plus evidence trail stack. |

Translation count: 149 → 228 keys, gate green.

---

## Round 3 — accessibility

Audited with axe-core 4.10 (WCAG 2.0/2.1 A + AA + best-practice) in both
languages, plus a keyboard-operation test and a structural lint, because the
three most serious findings here were ones axe cannot see.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The six loop steps carried `aria-selected` on plain `<li>` elements — invalid ARIA outside a listbox, and axe's only critical finding. | Each step is a real `<button>` with `aria-current`. |
| 2 | Worse than the ARIA: the steps were mouse-only. The one genuinely interactive control on the page could not be reached or operated by keyboard at all. | Native buttons: reachable by Tab, activated by Enter and Space. Verified by test — focusing step 5 and pressing Enter moves the ring to Verify. |
| 3 | The first pass at that fix put `<div>` inside `<button>`, which is invalid and gets reparented by the parser. | `<span>` with `display: block`. Caught by the new structural lint, not by eye. |
| 4 | `--fg-faint` was `#635d72` — **3.19:1**, below the 4.5:1 required for body text, and used across every mono caption and diagram label. | `#837d93`, **5.09:1**. Every ink token's measured ratio is now recorded in `base.css`. |
| 5 | **White on the primary button failed badly — 2.61:1 over the orange stop.** axe reported nothing because it cannot evaluate text over a gradient. The main call to action on the page was the least readable thing on it. | Near-black `--on-grad` (`#12080d`) instead: **4.74:1 at the worst stop, 7.17:1 at the best**, and the brand gradient keeps full saturation rather than being darkened to make white work. Applied to every gradient-backed control. |
| 6 | Footer used `<h4>` directly after `<h2>`, skipping a level. | `<h3>`. |
| 7 | Nav links were ~32 px tall and the language buttons ~29 px — fine for a mouse, under every touch guideline. | 44 px minimum under `@media (pointer: coarse)`. |
| 8 | **At 390 px the nav bar overflowed and pushed the burger off-screen.** The menu was completely unreachable on a phone — found only because a Playwright click timed out with "element is outside of the viewport". | Below 760 px the language switch, GitHub link and primary CTA relocate into the menu panel; the bar keeps the brand and the burger. |
| 9 | The footer logo referenced `<use href="#bm-use">`, an id that does not exist, and depended on a gradient defined inside the header's SVG. | One hidden sprite defines the gradient and the mark; both logos `<use>` it. |
| 10 | `list-style: none` strips list semantics in VoiceOver, and three non-interactive cards carried `tabindex="0"`, adding tab stops that do nothing. | `role="list"` on the styled lists; `tabindex` removed. Also added `prefers-contrast: more` support and `lang="zh-Hans"` on the 中文 button so it is pronounced correctly. |

Also fixed: the stuck nav at 72% opacity let headline text read straight
through it; raised to 86% with an opaque `@supports` fallback for engines
without `backdrop-filter`.

New tool: `scripts/check-html.mjs` — a dependency-free structural lint for
flow content inside buttons, nested anchors, duplicate ids, skipped heading
levels, and anchors or `aria-labelledby` pointing at ids that do not exist.
It is what found gap 9.

**Result: axe reports 0 violations in both languages; keyboard test clean
across 37 tab stops.**

---

## Round 4 — responsive

Audited across eleven widths (320 → 1920) with a script that reports horizontal
overflow, elements escaping the viewport, and — the useful one — the **actual
rendered pixel size of every SVG label after viewBox scaling**.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **SVG labels rendered as small as 6.8 px — including on a 1440 px desktop.** Text inside a viewBox is scaled with the drawing, so a 13-unit label in a 760-unit box shown at 660 px comes out at 8.3 px. This is invisible to review by eye and affected every diagram at every width. | Each `<svg>` now publishes `--dscale` (viewBox width ÷ rendered width) and the label rules multiply by it, so `13px` means thirteen *rendered* pixels whatever the viewBox is. Recomputed on load, on `fonts.ready`, on resize. |
| 2 | The hero chain was a 1000-unit horizontal rail; on a phone it became five dots with 7 px captions. | Vertical variant: five stacked nodes with the labels beside them and the cycle's return arc down the side. |
| 3 | Same for the value-shift axis. | Vertical variant, three stops. |
| 4 | Same for the broken-chain diagram — five boxes and four break marks compressed into 350 px. | Vertical variant, with the break marks and the evaporating particles between the stacked boxes. |
| 5 | Same for the harness — six gates and the rollback path, unreadable below ~700 px. | Vertical variant with the rollback running down the right-hand gutter. Both orientations now share one timeline driver (`runHarness`) so the failing-and-reversed run cannot drift between them. |
| 6 | The architecture stack kept its 760-unit box and its side brackets had nowhere to go at phone width. | 340-unit box below 700 px, tighter rows, brackets dropped — the surrounding copy already makes that point. |
| 7 | The ontology graph kept a 540×270 layout that put its labels at ~8 px on a phone. | A taller 320×350 arrangement of the same seven nodes and nine edges. |
| 8 | Resizing across the breakpoint left whichever variant had been built at load — a desktop diagram squeezed into a phone column, or the reverse. | `watchBreakpoint` rebuilds the diagrams when the media query flips. |
| 9 | The vertical chain's return arc reached `x − 52`; with the column at x = 46 that is −6, outside the viewBox, and the arc was clipped mid-curve on every phone. | Column moved to x = 60 with the viewBox widened to match. |
| 10 | The hero chip's label wraps to two lines on a phone, and its centred dot then sat in the gutter between them. | Aligned to the first line. |

**Result: clean at 320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440 and
1920 — no horizontal overflow, nothing escaping the viewport, no SVG text
under 9 px.** axe still 0 violations in both languages.

---

## Round 5 — motion

The brief asked for animation that explains the concepts, in the register Apple
uses. That register is mostly restraint plus damping: things follow you rather
than being bolted to the scrollbar, and nothing moves that is not carrying
meaning.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The pinned loop scene was driven 1:1 by `scrollTop`. It tracked every trackpad tremor and read as mechanical — the single biggest thing separating this from a considered scene. | The rendered value now eases toward the scroll value each frame (damping 0.14) and snaps when the remainder falls below a pixel's worth of progress. Verified: a jump to 90% shows the arc lagging, then settling. |
| 2 | Stage emphasis flipped at the boundary: six lights switching on and off. | Emphasis is continuous — each node gets `--e` from its distance to the scroll head, and dot scale, opacity, ring stroke and label opacity are all functions of it. Measured mid-scene: `[0, 0.30, 0.99, 0.32, 0, 0]`. |
| 3 | First attempt used a falloff of 1.0, so only the node directly under the head ever lit and it still read as binary. | Falloff widened to 1.45 so neighbours glow as the head approaches. |
| 4 | Scaling the active dot used the SVG `r` geometry property, which is not safely animatable across engines. | `transform: scale()` with `transform-box: fill-box`. |
| 5 | The aurora, the evaporating particles, the chain pulse and the live pip animate forever — compositing every frame on a very tall page, on a phone, on a battery, with nobody watching. | `[data-animates]` regions get `.is-offscreen` from an IntersectionObserver and CSS pauses their animations. Verified paused at the page bottom. |
| 6 | The scrub's rAF loop ran whenever the page scrolled, including when the scene was nowhere near the viewport. | The loop only runs while the track is within 200 px of the viewport. |
| 7 | The hero was completely static under scroll — it simply slid away. | The aurora moves at 0.22×, the content at 0.07× and fades out across the first viewport. Disabled under reduced motion. |
| 8 | The workspace illustration arrived fully built, so the evidence trail — the whole point of that section — was never seen assembling. | Notes and trail items land in sequence on reveal; the trail is the last thing to settle. |
| 9 | **`data-reveal="left"` and `"right"` park elements 24 px to the side. On a stacked phone layout that puts them past the viewport edge, giving the entire page a horizontal scroll range until they happen to be revealed.** Found while checking whether parallax caused overflow — it did not; this did, at every scroll position. | Horizontal offsets become vertical below 900 px, and `overflow-x: clip` replaces `hidden` on the body as a backstop — `hidden` makes the body a scroll container, which breaks `position: sticky` inside it. |
| 10 | The responsive test asked whether any element *reported* a wide box, which is noisy and missed the real symptom. | It now asks whether the page can actually be scrolled sideways — what a visitor would feel. That change is what exposed gap 9. |

All six loop stages verified reachable through the scrubbed scene:
Intent → Explore → Create → Act → Verify → Learn.

---

## Round 6 — performance

Measured, not guessed: transfer by type, FCP/LCP, CLS with per-shift
attribution, long tasks, DOM count and heap, over repeated runs.

Baseline: 244 KB transferred, FCP/LCP 316 ms, **CLS 0.031**, 756 DOM nodes.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **CLS 0.031**, all of it one shift at 228 ms attributed to the hero: the diagram hosts are empty at first paint and the page reflows when JS injects the SVG. | Every `[data-diagram]` host declares its aspect up front — per diagram, and separately for the narrow variants, which have different proportions. **CLS is now 0.0000.** |
| 2 | The module graph is three levels deep (`main` → `i18n`/`motion`/`diagrams`/`surface` → `zh`/`diagram-strings`) and each level is only discovered after its importer is fetched and parsed. | `modulepreload` for all seven, collapsing the waterfall into one parallel round. |
| 3 | No cache policy at all — fonts re-fetched on every visit, or stale CSS served against fresh markup. | `_headers`: fonts immutable for a year (a new face means a new filename), CSS and JS revalidated because they change in place on every deploy. |
| 4 | No security headers. | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`. |
| 5 | No CSP, on a page that loads nothing third-party and therefore has no excuse. | A strict same-origin policy. **Verified rather than assumed**: every response replayed with the header attached — 7 diagrams render, fonts load, the language switch works, zero violations. `'unsafe-inline'` is needed for style *attributes* only; there is no inline `<script>` and the policy now prevents one being added quietly. |
| 6 | `filter: blur(70px)` over three viewport-sized elements — an expensive paint for a backdrop nobody looks at directly. | 44 px (the blobs are already soft radial gradients, so most of the radius was doing nothing) plus `contain: paint` so the filter cannot invalidate the whole hero. |
| 7 | I assumed the two long tasks were my diagram rendering and was about to add lazy construction for them. | Measured first: `renderDiagrams` takes **15.5 ms**, and the long tasks start at 36 ms and 145 ms — before app code does anything. Recorded here so nobody "optimises" this later on the same hunch. |
| 8 | Fonts looked like 184 KB on disk. | `unicode-range` means latin-ext is never requested for either language: **78.7 KB actually transferred**. No change needed — but now known rather than assumed. |
| 9 | Two CSS classes and four custom properties were defined and referenced nowhere. Invisible: the page looks identical either way. | Removed. |
| 10 | Nothing would have caught gap 9, or the more serious version of it — a `var()` reading a property nobody declares, which silently resolves to nothing. | `scripts/check-css.mjs` fails on all three cases. |

**After: 246 KB, FCP/LCP 312 ms, CLS 0.0000, 763 DOM nodes, 1.2 MB heap.**

---

## Round 7 — typography and copy

The details that make a page read as unfinished without anyone being able to
say why. None of them are visible to a spell checker and all of them survive
every functional test, so this round ends with a gate rather than a fix list.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Straight double quotes in English copy — `"It looks right"`, `"Use AI"` — sitting in otherwise typeset paragraphs. | Curly quotes. |
| 2 | ASCII apostrophes: `someone's`, `organization's`. | Typographic apostrophes. |
| 3 | Six Chinese values used straight `"` where Chinese requires full-width `“ ”`. | Corrected. |
| 4 | Nothing would have caught any of that, and the same class of error recurs with every copy edit. | `scripts/check-copy.mjs`: straight quotes and apostrophes in English, straight quotes in Chinese, half-width punctuation between Han characters, missing space where Chinese meets latin or a digit, `...` instead of `……`, double hyphens, doubled spaces. 261 Chinese values checked. |
| 5 | Chinese had no line-breaking rules. `line-break: strict` is what keeps closing brackets and small kana off the start of a line; `word-break: normal` is what permits breaks between Han characters at all. | Both set under `:lang(zh)`. |
| 6 | A long unbroken token — a URL, a compound identifier — cannot be hyphenated in a narrow column and pushes the layout sideways. | `overflow-wrap: break-word` on the text elements. |
| 7 | Numerals in the mono indices were proportional, so the column of step numbers was ragged. | `tabular-nums`. |
| 8 | No hanging punctuation, so a paragraph opening with a quotation mark looks accidentally indented. | `hanging-punctuation: first last` where supported. |
| 9 | **Han glyphs fill their em box and latin letters do not**, so at an identical pixel size the Chinese headline read markedly heavier and larger than the English it replaced — the two languages stopped looking like the same design. | Display sizes scaled to 0.86 / 0.90 / 0.94 under `:lang(zh)`, with the line heights adjusted to match. |
| 10 | FAQ rows were 54 rem wide, leaving the chevron marooned at the far end of the row, visually detached from the question it belongs to. | 46 rem. |

Checked and found already correct: CJK/latin spacing throughout both
dictionaries, and full-width punctuation between Han characters.

---

## Round 8 — findability and the bilingual contract

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The Chinese site did not exist as far as the web was concerned.** Language was client state: one URL, English in the markup, and no way to link anyone to the Chinese page. Unindexable, unshareable, lost on refresh. | Language is a URL. `scripts/build-i18n.mjs` prerenders `zh/index.html` from `index.html` + `zh.js`. Verified: with JavaScript disabled the Chinese page carries **2,691 Han characters**, `lang="zh-Hans"`, all 14 sections. |
| 2 | Two hand-maintained HTML files would drift within a week. | `build-i18n.mjs --check` re-generates in memory and fails if the committed file differs. It is in `check-all.mjs`, so forgetting to regenerate is caught, not shipped. |
| 3 | No canonical URL and no `hreflang`, so the two pages would have competed as duplicates. | `canonical` per page, `hreflang` for `en`, `zh-Hans` and `x-default`, mirrored in the sitemap. |
| 4 | Sharing a link produced a blank card — no `og:image` at all. | `assets/img/og.png` and `og-zh.png`, generated by `build-og.mjs` from `og-card.html` — a real page using the site's own tokens and typeface, so the card cannot drift from the design the way a hand-drawn image does. |
| 5 | The first card came out flat black: the scrim over the aurora was at 0.82 and erased it. | Radial scrim that holds the type without killing the glow. |
| 6 | `<title>`, `description` and the social copy stayed English on the Chinese page. | All localized by the generator. |
| 7 | No `robots.txt`, no `sitemap.xml`. | Both, with the language alternates declared. |
| 8 | No structured data. | `SoftwareApplication` JSON-LD with both languages and the publisher. |
| 9 | A mistyped URL hit the host's default error page. | `404.html`, using the site's own styles, offering both languages. |
| 10 | Nothing told a Chinese-preferring visitor the Chinese page existed — and an automatic redirect would have been worse: it breaks the back button, hides one language from crawlers, and overrides a deliberate choice. | A dismissible offer in the language being offered, remembered per visitor. |

The restructure also **deleted** the runtime translation machinery: no
`textContent` swapping, no `langchange` event, no rebuilding diagrams and the
split headline on switch. `i18n.js` is gone; `lang.js` only reports which page
you are on. The page now arrives in its final language.

New: `scripts/check-all.mjs` runs all five gates as one command.

Verified after the restructure: axe 0 violations both languages, keyboard clean,
CSP clean, responsive clean at all eleven widths, diagrams render Chinese labels
on `/zh/`, stylesheets resolve from the subdirectory, language links cross-
reference correctly.

---

## Round 9 — robustness

What happens when conditions are not ideal: no scripting, a blocked request,
200% zoom, high-contrast mode, a printer.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **With JavaScript disabled the page was blank.** 37 elements sat at `opacity: 0` waiting for a reveal that could never arrive. The copy was in the markup and none of it could be read. | Two independent guarantees. A `<noscript>` `<style>` drops the reveal mechanism when scripting is off — instant, no flash, nothing to load. And `main.js` marks `<html class="js">` as its first act, so if it never runs the failsafe animation reveals everything after 1.2 s. Neither replaces the other: the first does nothing when scripting is on, the second does nothing when it is off. |
| 2 | **My own test said this was fine.** It sampled computed styles at `domcontentloaded`, before the stylesheets had applied, and reported zero hidden elements. | The test now waits for `load` and settles first. Worth recording: a green test is not evidence until you have checked it can go red. |
| 3 | **Round 1 of this log, and the README, both claimed the page was "complete with JavaScript disabled".** It was not, from the first commit until this round. | Fixed, and the claim is now true and tested rather than asserted. |
| 4 | With `diagrams.js` blocked, *nothing* ran — not the nav, not the reveals. One failed import aborted the whole boot function and left a blank page. | Every boot step is wrapped and logged independently, reveals go first so later failures cannot hide content, and the `js` flag is set before anything that can throw. Verified: with `diagrams.js` blocked, 0 of 29 elements stay hidden. |
| 5 | Printing produced a fixed navigation bar stamped over every sheet, white text the printer renders as grey, and collapsed FAQ answers that simply vanished. | `print.css`: light palette, chrome dropped, pinned scenes unpinned, `break-inside` on the cards, answers forced open, and external URLs printed next to their labels. The dark-surface diagrams are hidden — in ink they are empty boxes. |
| 6 | In Windows high-contrast mode the primary button lost its gradient — the engine drops background images — leaving text on nothing. | A `forced-colors` block using system colours (`Highlight`, `ButtonFace`, `CanvasText`) and real borders, which is the one thing forced-colors preserves. |
| 7 | Unknown whether a blocked font breaks the diagram label sizing, which is derived from measured widths. | Tested: all 7 diagrams render with `*.woff2` aborted. No change needed. |
| 8 | Unknown whether the layout survives 200% browser zoom (WCAG 1.4.4 reflow). | Tested at 1280 px zoomed to 200%: no horizontal scrolling. No change needed. |
| 9 | `localStorage` throws in some privacy modes rather than returning null. | Already guarded at both call sites; confirmed rather than assumed. |
| 10 | `IntersectionObserver` and `document.fonts` absent on older engines. | Already guarded — reveals fall back to immediately visible, scale sync to a single pass. Confirmed by reading, not assumed. |

Gaps 7, 8, 9 and 10 needed no code change. They are listed because "checked and
found correct" is a result, and the alternative is checking them again later.

---

## Round 10 — final sweep

A pass over the sections that had not been looked at since they were built,
plus the checks that only make sense once everything else is settled.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Two invented URLs were sitting in the markup.** "Launch App" pointed at `https://app.boardx.us`, which appears nowhere in this repository — the only app host referenced anywhere is `devapp.boardx.us`. | Corrected, and the remaining placeholder — the public domain in every canonical, `hreflang`, `og:url` and sitemap entry — is now flagged at its definition and documented under "Before this goes live" in the README. It is a guess and it is labelled as one. |
| 2 | **The CTA's glow was painting over its own headline.** An absolutely positioned pseudo-element outranks static in-flow content, so the pink radial sat on top of the white type, tinting it and eating contrast. | `z-index: -1` with `isolation` on the parent. Verified by sampling the rendered pixels: glyph interiors measure exactly `rgb(246, 244, 249)`, the intended ink. The remaining warmth is the glow around the letters, which is the effect. |
| 3 | Same mistake in the diagram stages: the grid-paper backdrop was painting *over* the diagrams it exists to sit behind. | Same fix. |
| 4 | **The context thread joining the three scale cards never drew for anyone who asked for less motion** — it was wired only into the animated code path, and the reduced-motion branch returned before reaching it. | Marked in both branches, plus a CSS fallback so it draws even if the observer never runs. |
| 5 | That thread was positioned at a hand-guessed `4.25rem`, while the badges it should run through sit at a fluid offset that moves with the viewport. | Derived from the same `clamp()` the card padding uses, so they track together. |
| 6 | Scale card subtitles mixed cases — `Research · writing · analysis · planning`. | Consistent capitalization across all three. |
| 7 | A sweep for the same layering mistake everywhere else: ten absolutely positioned pseudo-elements without a `z-index`. | Seven are small marks — bullets, underlines, the burger bars — where painting above is correct. Three were backdrops, and all three were wrong. Fixed. |
| 8 | Whether the whole thing still holds together after nine rounds of change. | Every harness re-run: axe 0 violations in both languages, keyboard clean, responsive clean across eleven widths, motion clean, robustness clean, bilingual clean, CSP clean. |
| 9 | Page weight drifted up as content was added. | 257 KB, FCP/LCP 312 ms, CLS 0. The growth since round 6 is the two social cards, which are not on the critical path. |
| 10 | The five gates were only ever run by hand, one at a time. | `check-all.mjs` is the single command, and it covers i18n parity, HTML structure, dead CSS, copy typography and Chinese-page freshness. |

---

## Where it stands

**Verified, not asserted:**

| | |
|---|---|
| Accessibility | axe-core 0 violations, EN and ZH; 37 tab stops all reachable and focus-ringed |
| Responsive | clean at 320 / 360 / 390 / 430 / 600 / 768 / 900 / 1024 / 1280 / 1440 / 1920 |
| Performance | 257 KB, FCP/LCP 312 ms, CLS 0.0000 |
| Bilingual | `/zh/` carries 2,691 Han characters with JavaScript disabled |
| Robustness | readable with no JS, with a failed module, at 200% zoom, in forced colors, and on paper |
| Security | strict same-origin CSP, verified by replaying every response with the header attached |

**Known placeholders:** the public domain, and the product link. Both are
documented in the README.

**Deliberately not on the site:** the deck's market sizing, competitive
positioning map, business model and go-to-market. The deck labels those figures
internal scenario models rather than third-party forecasts, and publishing them
as fact would be misleading.

---

# Second pass — rounds 11 to 20

The first ten rounds made the page work. These ten ask a harder question: is it
*persuasive*, and does it hold up to someone looking for reasons to disbelieve
it.

---

## Round 11 — credibility

The page argued a thesis, showed a mock of the product and asked for design
partners. It offered no evidence that any of it exists.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Nothing on the page said what the product actually contains. A reader had no way to tell whether this is a running system or a position paper. | New **In the box** section: eight surfaces that exist in the repository today — agent-team chat, canvas and diagrams, deep research, the agent/skill runtime, live collaboration, transcription, research and interviews, projects and governance. Drawn from the module list, not invented. |
| 2 | **The strongest available argument was missing entirely: WorkspaceX is built by agent teams under the harness it ships.** A product that claims evidence-gated agentic work, and is itself produced that way, has proof no competitor can copy. | New **Built by the system it describes** section, with four rules taken verbatim from the repository's own contract: no issue, no work; an agent cannot mark its own work done; evidence or it did not happen; merged, green, closed by a pull request. Links to the public repository so the claim is checkable. |
| 3 | **At 1280 px the "Launch App" button was clipped off the screen.** `.nav__actions` ended at x = 1318 in a 1280 px viewport. Invisible as a symptom, because `overflow-x: clip` on the body removes the scrollbar that would have revealed it. Adding a seventh nav item pushed it over. | The bar runs to 84 rem rather than the 72 rem content measure, link padding tightens below 1320 px, and the burger breakpoint moves from 1040 px to 1160 px — at 1100 px the row fit by 20 px, which is not a margin once a translated label is one character longer. Verified at 8 widths × 2 languages. |
| 4 | Nothing would have caught gap 3, since the clip produced no scrollbar and no error. | A nav-fit harness that asserts the actions never pass the viewport edge and never collide with the links while the inline nav is showing. |
| 5 | The section numbering drifted again once two sections were inserted. | Re-derived from DOM order across both languages, as in round 2. |
| 6 | A straight double quote went into the new English copy. | Caught by `check-copy.mjs` — the gate paying for itself two rounds after it was written. |
| 7 | The Chinese copy had drifted into using 「」 in one place and “” everywhere else. | Unified on “”. |
| 8 | The proof section's headline used the full-width `h2` size inside a half-width column and ran to four lines, dwarfing the rules beside it, which are the substance. | Scaled down for that column. |
| 9 | The footer had never learned about the sections added in rounds 2 and 11. | Both added. |
| 10 | The nav carried a "Beta" tag that asserted a stage and explained nothing. | It is now a link reading "Early access" that jumps to the answer about what stage this is at. |

228 → 296 translated values, all gates green.

---

## Round 12 — interaction

The page was a scroll and nothing else. Two of its central claims were made in
prose and never demonstrated, when demonstrating them is cheap.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The most important comparison on the page was never actually shown.** The broken work chain got a diagram; what replaces it was described two sections later in words. The reader had to hold the before in their head to understand the after. | A segmented switch over one frame: *Today* and *With WorkspaceX*, same five steps, swapped in place. Both states share a grid cell so the stage does not resize — measured 417 px against 418 px across the switch. |
| 2 | **"Model-agnostic" and "the middle must not move" were assertions the diagram never supported.** Five labelled boxes, nothing to do. | Layers are selectable, and selecting one highlights everything a change there would disturb. Selecting the model layer lights up **nothing else** — the claim, demonstrated. Selecting the ontology lights up three. Verified by test, not by eye. |
| 3 | Making the SVG interactive broke its semantics: it was still `aria-hidden` while containing focusable controls, and its host was still `role="img"` while containing interactive descendants. **Two serious axe violations, both introduced by the feature that was supposed to improve the page.** | `role="group"` on the host, `aria-hidden` removed, and each layer given an `aria-label` — SVG `<text>` does not name its ancestor the way HTML content does. Back to 0 violations. |
| 4 | **The compare panes hung 160 px outside their stage at every width below ~1100.** A grid item defaults to `min-width: auto`, which is its min-content size, and an `<svg>` with a viewBox and no width attribute reports an intrinsic width of the viewBox — 1000 px. | `min-width: 0`. Caught by the responsive harness at 900 and 1024, which is exactly the range nobody reviews by eye. |
| 5 | The new layer controls suppressed their outline and relied on a stroke change on a child element — which is unreliable on engines where focus styling inside SVG is patchy. | Both indicators kept. Suppressing either leaves keyboard users guessing on some browser. |
| 6 | A 17,000 px page offered no sense of position. A scrollbar thumb at that height is a grain of rice. | Reading progress along the bottom edge of the nav, driven per frame with no easing — easing it makes it lag the content it describes. |
| 7 | The new switch responded to clicks only, when a segmented control should move under the arrow keys. | Left and right move and select. |
| 8 | The inactive compare pane stayed in the accessibility tree, so a screen reader would announce both versions of the same diagram back to back. | `hidden` and `aria-hidden` on whichever is off. |
| 9 | The nav's new "Early access" tag wrapped to two lines and stretched the whole brand block. | `white-space: nowrap`. |
| 10 | Two harnesses went stale against the new page: the diagram count moved from 7 to 8, and the focus-ring check could not see an indicator rendered on an SVG child. | Both updated. A harness that silently measures the old page is worse than no harness. |

Everything re-verified: axe 0 in both languages, keyboard clean, responsive
clean at eleven widths, robustness clean, and two new harnesses covering the
switch and the layer explorer.

---

## Round 13 — the editorial pass

Every word read in sequence, as prose, rather than section by section. What
surfaces that way is repetition — the page had been making the same point in
three places without anyone noticing, because nobody reads a page the way it
gets written.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Mixed spelling conventions**: `centre`, `modelled` (three times) and `judgement` sitting alongside `organization` and `-ize` endings. Nothing looks more unfinished to a careful reader. | Standardized on American, which is what the rest of the copy already used. |
| 2 | The serial comma appeared twice and was omitted everywhere else. | Omitted throughout. |
| 3 | **`Model-agnostic` in the architecture column duplicated the new interactive detail panel almost word for word** — the panel now says it better, and only when asked. | Cut. |
| 4 | `Trust by design` repeated both `arch.d3` and the trust section's lead. | Cut. |
| 5 | `Deploy anywhere` repeated the first FAQ answer nearly verbatim — "a deployment choice, not a different product" against "a configuration choice, not a different edition". | Cut. |
| 6 | Having cut three of four, the survivor should earn its place. | Replaced with **why the line sits where it does** — that everything above the harness is meant to be replaceable and everything at or below it is the part that is yours. That argument appears nowhere else on the page, and the section is shorter than before. |
| 7 | `minimum actionable agentic unit` — jargon introduced in one sentence, never defined, never used again. | Plain language. If a term is not going to be used twice it is not a term, it is friction. |
| 8 | The proof section's eyebrow read "The strongest argument we have" — a boast in a label position, which undercuts the argument that follows. | "How this is built". Let the reader reach that conclusion. |
| 9 | The closing headline, "The work layer is being built now", described the weather rather than asking for anything, on the one screen whose whole job is to ask. | "Bring us work that can be checked." |
| 10 | `Seat → Work Unit → Outcome` against "unit of work" used four times elsewhere. | Aligned. |
| 11 | Chinese: `那正好是反的` is a literal rendering of "that is the opposite", not something a Chinese writer would produce. | `恰恰相反`. |

Net effect: three duplicated blocks removed, one sharper paragraph added, and
a page that says each thing once.

---

## Round 14 — the design system, audited

Not a look-and-feel round. A count of what the stylesheets actually do, which
turned out to be quite different from what the token block claims.

**Before: 40 tokens, and then twelve border-radius values, seventeen font sizes
and nine gap values chosen outside them.**

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Twelve distinct border radii**: 22, 14, 12, 11, 10, 9, 8, 6, 3, 2, 1.5 px and `50%`. Each one arrived reasonably — a component needed *just a bit* rounder — and together they are why a page stops feeling designed. | A four-step surface scale (`--r-xs` 6, `--r-sm` 10, `--r-md` 14, `--r-lg` 22) plus the two shapes. Values moved by at most 2 px, which is the point. |
| 2 | **Seventeen font sizes set as literals outside the type scale**, while `--t-*` tokens sat unused beside them. | The missing steps named: `--t-nano`, `--t-tiny`, `--t-xs`, `--t-md`, `--t-base`, `--t-lg`, `--t-xl`. |
| 3 | Nine ad-hoc gap values between 0.25 and 1.5 rem. | A six-step space scale, applied to gap, padding and margin. |
| 4 | `--radius-lg` was the only radius token and even it was bypassed half the time. | Replaced by the scale and the last literal removed. |
| 5 | **Nothing stopped any of this from happening again**, which is why it happened at all. | `check-css.mjs` now fails on any `border-radius` or `font-size` set outside the token system. The `:root` block is exempt, since that is where the scales are declared, and `print.css` is exempt because it is measured in points on purpose — an explicit carve-out rather than one that passes by accident. |
| 6 | The space scale I first wrote had a step (`--s-7`) nothing used. A scale with dead steps invites picking the nearest thing rather than stepping along it. | Removed. |
| 7 | The few-pixel marks — list bullets, legend swatches, the horizon bars — sit below the smallest surface radius and had no home. | `--r-nub`, rather than an exemption. A carve-out for "small things" becomes a carve-out for everything. |
| 8 | Mixed colour literals for near-background surfaces (`#0b0910`, `#050408`) alongside the tokens. | Left as is deliberately — they are distinct surfaces, not drift — but now visible in the audit rather than buried. |
| 9 | Unknown whether a mechanical rewrite of every radius, size, gap, padding and margin in five stylesheets broke anything. | Re-verified: responsive clean at eleven widths, axe 0 in both languages, keyboard clean, and both new interactions clean. |
| 10 | The audit itself was a one-off script run by hand. | Its findings are now assertions in the gate, so the next person does not have to think to notice. |

**After: 59 tokens, and every radius, size and spacing value stepping along
them.**

---

## Round 15 — the other two engines

**Stated plainly: every round up to this point was verified in Chromium only.**
Playwright's browser CDN is blocked by this environment's egress policy, so
Firefox and WebKit could not be installed and cannot be run here. That is a
real limitation of the verification, not something to paper over.

What can be done instead is to stop relying on whoever writes the next line of
CSS to remember what Safari 15 does with it.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Two `MediaQueryList.addEventListener` calls. That method arrived in **Safari 14**; below it the call throws — and both are attached during boot, so on an older iPhone the exception took the rest of the page's behaviour with it. | `mq.js` prefers the modern API and falls back to `addListener`. |
| 2 | **The mobile menu's `backdrop-filter` had no `-webkit-` prefix**, so on Safari below 18 the panel had no blur at all — text over text. Every other use on the page was prefixed; this one was added later and missed. | Prefixed. Found by the new gate on its very first run. |
| 3 | **No `color-scheme: dark`.** Safari and Firefox then draw a white scrollbar track and light form controls against a near-black page — the single most common "your site looks broken" report on dark sites. | Declared. |
| 4 | `overflow-x: clip` on the body, which **Safari only gained in 16.4**. Below that the declaration is dropped and nothing constrains the page at all, so the fallback was to none. | `@supports not (overflow: clip)` falls back to `hidden`. |
| 5 | Default scrollbars against the dark page. | `scrollbar-color` for Firefox and the `::-webkit-scrollbar` pseudo-elements for the others. |
| 6 | iOS Safari flashes a grey box on every tap, which on a dark site reads as a rendering fault. | `-webkit-tap-highlight-color` in the brand tint. |
| 7 | Double-clicking a button or a segment selected its label. | `user-select: none`, prefixed. |
| 8 | `text-size-adjust` was only the `-webkit-` form. | Standard property added alongside. |
| 9 | None of the above was checkable, which is why items 1 to 4 existed. | `scripts/check-compat.mjs`: five rules pairing a risky pattern with what counts as a guard. In `check-all.mjs`. |
| 10 | Its first version flagged a *comment describing* the `overflow: clip` fallback as an unguarded use of it. | Comments are stripped before matching. A gate that reads commentary as code teaches people to delete comments. |

**The fallback path is exercised, not assumed.** A test replaces `matchMedia`
with an object exposing only the pre-Safari-14 surface and asserts the page
still boots: `html.js` set, 8 diagrams drawn, both interactions initialized, no
errors. And — per round 9's lesson — it was checked in the other direction
too: with the shim forced down its modern branch, the test fails with a stack
trace through boot. A green test is not evidence until it has been seen red.

---

## Round 16 — the pages an enterprise buyer asks for

A site that asks organizations to hand it their work had no privacy statement,
no way to report a vulnerability, and nothing to say about accessibility. Those
three are the first attachments a procurement review asks for.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **No privacy statement**, on a site whose own source comments boast about not handing visitor addresses to a font host. | `/privacy.html` and `/zh/privacy.html`. Short, because the truthful version is short: no analytics, no pixel, no A/B testing, no advertising code. |
| 2 | The site writes one key to local storage and never disclosed it. | Named in the statement, along with what it is for and how to remove it. |
| 3 | **No way to report a security problem.** | `/.well-known/security.txt` per RFC 9116, plus a section committing to acknowledge reports and not to pursue good-faith researchers. |
| 4 | No accessibility statement — routinely requested in enterprise procurement. | A section stating the WCAG 2.1 AA target, that axe runs on every build in both languages, and **the two places the page deliberately falls short**, because a statement that admits nothing is not information. |
| 5 | **The generator only knew how to produce one page**, so a second bilingual page had nowhere to live. | `build-i18n.mjs` takes a page list; canonical, `hreflang`, `og:url` and the language links are derived per page. |
| 6 | **Every gate named `index.html` as its input.** `privacy.html` passed all five without any of them looking at it — the failure mode of any check that names its input instead of discovering it. | All four now scan every hand-authored page. They immediately found a straight apostrophe and an off-scale font size in the new page. |
| 7 | **A nested `<a>` had been in the nav since round 11** — the stage tag was placed inside the home link. Browsers silently reparent it, so nothing looked wrong. | The wrapper is a plain element and the two links are siblings, which is what the rendered DOM was anyway. |
| 8 | **The rule meant to catch that had been reporting clean for four rounds.** A non-greedy `<a>…</a>` match stops at the *first* closing tag, so the inner anchor never appears in the captured body. | Depth counting. The lesson is the same one as round 9: a check that has never been seen red is a decoration. |
| 9 | The 404 page was English only, so a Chinese visitor hitting a bad URL got English — and an error page cannot know which language they came for. | Both languages on the one page, with the Chinese heading marked as a paragraph rather than a second `<h1>`: same statement, not a second document outline. |
| 10 | Serving `/zh/` from mainland China legally requires an ICP record number in the footer, and there is none in this repository. | **Not invented.** Documented in the README as the third thing to set before launch. |

New pages verified at 390 and 1440 in both languages: axe 0 violations, no
horizontal scroll, every stylesheet resolving from the subdirectory.

---

## Round 17 — performance under conditions that are not a localhost

Round 6 measured an unthrottled desktop against a server on the same machine.
That is the easy case, and it hid the two worst numbers on the page.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Scrolling ran at 15 fps.** Median frame 66.7 ms, p95 116.6 ms — and not on a phone: on an unthrottled 1440 px desktop, where the throttled phones were managing a clean 16.7 ms. | Isolated by elimination: removing the hero aurora restored 16.7 ms, removing its blur restored 16.7 ms, and removing anything else changed nothing. **Three ~50 vw circles under a CSS blur were the entire cost.** |
| 2 | Round 5's off-screen pause did not help, and neither did `visibility: hidden` with `filter: none` — verified with the class actually applied and the computed filter actually `none`. Only removing the element from the DOM restored 60 fps. The compositor keeps carrying those layers regardless. | The blur never changes, so it has no business being recomputed sixty times a second. `scripts/build-aurora.mjs` bakes it once to a **23 KB** JPEG; the only thing that moves at runtime is a transform. **16.7 ms median and p95, through the hero and through the pinned scene alike.** |
| 3 | **CLS had regressed to 0.0174 on mobile** while desktop read 0.0000 — so round 6's "CLS is zero" was true only of the viewport it was measured at. | Attributed: `.nav__actions` renders 87 px tall and snaps to 40 px at 245 ms, because round 3's relocation of the secondary controls into the menu panel runs in JS after first paint. The end state is declared in CSS now, so the bar is never wrong even for one frame. **Mobile CLS back to 0.0000.** |
| 4 | Found while fixing that: **without JavaScript there is no navigation at all on a phone.** The burger cannot open the panel, and the panel is where everything lives. | The `<noscript>` block lays the nav out statically — links inline, actions back in the bar, no burger. |
| 5 | The aurora is referenced from a stylesheet, so it is discovered only after the CSS parses — late, for the first thing above the fold that is not text. | `preload` with `fetchpriority="high"`. |
| 6 | Round 16's un-nesting of the brand left `.brand__home` shrinkable, so the mark and the wordmark wrapped onto two lines at desktop widths. | `flex-shrink: 0`. The brand is the one thing in the bar that never gives. |
| 7 | The CSS dead-code gate read `url("../img/aurora.jpg")` as a class called `.jpg`. | `url()` payloads are stripped before class matching. |
| 8 | Nothing measured frame timing at all, so item 1 had been true for twelve rounds. | A harness that scrolls the pinned scene under `requestAnimationFrame` and reports median, p95, worst and the share of frames over 33 ms, at four device profiles. |

**Measured after, four profiles:**

| profile | load | LCP | CLS | scroll median | frames > 33 ms |
|---|---|---|---|---|---|
| desktop, unthrottled | 231 ms | 260 ms | 0 | 16.7 ms | 0% |
| mid phone (4× CPU) | 1 069 ms | 416 ms | 0 | 16.7 ms | 0% |
| low phone (6× CPU) | 1 140 ms | 496 ms | 0 | 16.7 ms | 0% |
| slow 3G + 4× CPU | 6 978 ms | 5 820 ms | 0 | 16.7 ms | 0% |

**The slow-3G LCP of 5.8 s is not acceptable and is not fixed here.** It is
recorded rather than rounded off; round 18 takes it.

---

## Round 18 — the 5.8 second load

Round 17 ended with slow-3G LCP at 5.8 s and a note that it was not acceptable.
The first thing the profile showed was that FCP and LCP were the *same*
number: nothing rendered at all until the last stylesheet landed.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Every performance number in this log had been measured against an uncompressed origin.** `python -m http.server` does not compress; no real host serves that way. The figures were roughly 4× pessimistic for text. | A compressing server for measurement. Over the wire the stylesheet is **11 KB**, not 52, and the page **14 KB**, not 45. |
| 2 | Six render-blocking stylesheets, six requests, nothing painting until all of them arrived. | `build-css.mjs` bundles them. The sources stay split by concern, because that is how they are edited; the page fetches one file, because that is how it is fetched. `--check` fails on a stale bundle. |
| 3 | The stylesheets are heavily commented on purpose — most of it records *why* a value is what it is. None of it has any reason to reach a browser. | Stripped in the bundle only: 74 KB of sources become 52 KB shipped. The commentary stays where it is read. |
| 4 | **`zh.js` was preloaded on every page and imported by nothing at runtime.** It is a build-time input; the round-8 restructure removed the import and left the preload. 24 KB fetched on every English page load, for a file the browser never used. | Removed. |
| 5 | Nine `modulepreload` links put the scripts in direct competition with the stylesheet that decides when anything appears — on a page that is, since round 9, completely readable without them. | All removed. The modules are discovered when `main.js` parses, one round trip later: nothing on a fast link, seconds on a slow one. |
| 6 | Inter, 47 KB, preloaded — taking bandwidth from that same stylesheet. | Only the display face is preloaded now. |
| 7 | The aurora carried `fetchpriority="high"`: a decorative backdrop ranked above the words. | `low`. It now finishes *after* first paint, which is where a backdrop belongs. |
| 8 | Dropping the Inter preload reintroduced layout shift — it swaps in late and reflows the body copy. CLS 0.0089. | Metric-matched fallback faces (`size-adjust`, `ascent-override`, `descent-override`) so the stand-in holds the exact line boxes the real face will occupy. The swap changes letterforms and nothing else. **CLS back to 0.** |
| 9 | Restructuring the head dropped `print.css` from the home page, and the earlier regex removed the 404 page's stylesheet entirely. | Both restored — caught because the document-page harness from round 16 checks that every stylesheet resolves. |
| 10 | The bilingual harness still expected 7 diagrams after round 12 added an eighth. | Updated. |

**Slow 3G, 4× CPU: 6 204 ms → 1 960 ms LCP.** And with compression, which is
what will actually be served:

| profile | load | LCP | CLS | scroll |
|---|---|---|---|---|
| desktop | 205 ms | 204 ms | 0 | 16.7 ms |
| mid phone (4× CPU) | 809 ms | 460 ms | 0 | 16.7 ms |
| low phone (6× CPU) | 1 287 ms | 588 ms | 0 | 16.7 ms |
| slow 3G + 4× CPU | 3 728 ms | 1 960 ms | 0.0007 | 16.7 ms |

---

## Round 19 — making the verification survive

Eighteen rounds of checks, and the browser ones lived in a scratch directory
outside the repository. Nobody else had them. They would have vanished with the
session. And their expectations were numbers typed in by hand, which had gone
stale **four separate times**: twice on the diagram count, once on the section
count, and once on a focus check that could not see an indicator drawn inside
an SVG. Each time the check reported clean against a page that no longer
existed.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The browser checks were not in the repository. | `apps/home/tests/` — seven suites in `browser.test.mjs`, a budget in `perf.test.mjs`, shared plumbing in `harness.mjs`. |
| 2 | Expectations were magic numbers, and magic numbers rot. | Derived from the source: section count, diagram-host count, loop steps and nav links are read out of `index.html` and asserted against the rendered page. A number that changes in the markup changes in the test. |
| 3 | **The derived count found dead markup on its first run.** `data-diagram="scales"` — a host with no builder, present since round 1, rendering nothing and reporting nothing. Every hardcoded "expect 8" had been quietly agreeing with it. | Removed. |
| 4 | The renderer shrugged at an unknown diagram kind, which is why item 3 survived eighteen rounds. | It warns now. |
| 5 | No performance budget, so the two hardest-won numbers on the page — 60 fps scrolling and a 2 s slow-3G LCP — could regress silently and nobody would know until it was old. | `perf.test.mjs` fails on transfer, LCP, CLS or frame time over budget, at two device profiles. Budgets set just above current, so drift is caught while it is small. |
| 6 | The measurement server did not compress, which made every transfer figure in this log about four times pessimistic. | The in-repo harness compresses, like every real host. **146 KB** over the wire, not 312. |
| 7 | Playwright and axe-core are dev tools, not dependencies of this project, so a suite that required them would fail on a bare checkout. | Both suites detect and skip with a message. `--static-only` runs the text gates alone in about two seconds. |
| 8 | The first version of the suite took **over ten minutes** — 22 fresh browser contexts, each loading the page and scrolling its full height. A gate nobody runs is not a gate. | One context per language, resized between widths, and no scroll walk: reduced motion lands every reveal immediately, so the walk was doing nothing. **58 seconds.** |
| 9 | Checks were invoked one at a time by hand. | `check-all.mjs` runs all eight. **72 seconds, one command.** |
| 10 | Nothing recorded which numbers were budgets and which were observations. | The budget file says so, and says that raising a number should take an argument rather than a shrug. |

---

## Round 20 — the deployment, and reading it all again

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The Chinese home page linked to the English privacy page**, and the Chinese privacy page's brand, nav "back" and footer link all landed on the English site. Three links out of the language on one page, shipping. | The generator maps internal links to their translated equivalents. The language switch is exempt by definition — pointing at the other language is the only thing it does. |
| 2 | Nothing checked for that, which is why it shipped. | A rule in `check-html.mjs`: on a generated page, every internal link outside the language switch must stay inside that language. |
| 3 | The `_headers` comment asserted "there is no inline `<script>` anywhere". There is one — the JSON-LD block. | Corrected, and the claim underneath it *verified*: every response replayed with the policy attached, confirming the structured data still parses (`SoftwareApplication`, both languages) with no violation. `script-src` does not govern non-executable data blocks, but that was worth demonstrating rather than believing. |
| 4 | No `_redirects`. `/privacy`, `/zh`, `/security` and `/security.txt` would all 404 — the last two being the shapes a researcher types first. | Declared, including the security-contact aliases. |
| 5 | Checked whether the README still describes the site after nineteen rounds of change. | Every path it names exists. |
| 6 | The seven source stylesheets still deploy alongside the bundle. | Deliberate, now that it is deliberate: a visitor holding a cached copy of the pre-bundle HTML still resolves them. |

---

# Where this ended up

**Twenty rounds. Every number below is produced by `node scripts/check-all.mjs`,
in 72 seconds, from the repository.**

| | |
|---|---|
| Accessibility | axe-core: **0 violations** across 5 pages in 2 languages; every control reachable and operable by keyboard |
| Responsive | clean at 320 / 360 / 390 / 430 / 600 / 768 / 900 / 1024 / 1280 / 1440 / 1920, both languages |
| Performance | **146 KB** compressed · LCP **276 ms** desktop, **1 976 ms** on slow 3G · CLS **0** · **60 fps** scrolling |
| Bilingual | `/zh/` carries 2 691 Han characters with JavaScript disabled |
| Degradation | readable with no JS, with a failed module, at 200% zoom, in forced colors, on paper |
| Compatibility | the pre-Safari-14 path is exercised, not assumed |
| Security | strict same-origin CSP, verified by replaying it over every response |

**Eight gates**, all in `check-all.mjs`: translation parity, HTML structure,
dead CSS and off-scale values, copy typography, engine-compatibility guards,
two freshness checks on generated files, seven browser suites, and a
performance budget.

## What is still open

1. **The public domain is a guess.** Every canonical, `hreflang`, `og:url` and
   sitemap entry says `workspacex.boardx.us`. See the README.
2. **The ICP filing number** required to serve `/zh/` from mainland China is
   not in this repository and was not invented.
3. **Firefox and WebKit have never been run against this.** The browser CDN is
   blocked in the environment this was built in. `check-compat.mjs` encodes
   what is known about those engines; it is not a substitute for running them.
4. The deck's market sizing, competitive map, business model and go-to-market
   are deliberately absent — the deck itself labels those figures internal
   scenario models rather than forecasts.

## The pattern worth keeping

The defects that survived longest were not in the page. They were in the
checks:

- a nested `<a>` that a non-greedy regex could never see, reported clean for
  four rounds;
- a no-JavaScript test that sampled styles before the stylesheet applied, and
  so certified a blank page as fine;
- four separate stale expectations that agreed with a page which no longer
  existed;
- a diagram host with no builder, invisible because every count had been
  typed in by hand rather than derived.

**A check that has never been seen to fail is a decoration.** Round 15 started
testing the fallback path in both directions because of it, and round 19
rebuilt every expectation to derive from the source. Both changes found real
bugs within minutes of being written.

---

## Round 21 — disciplines, and verifying the Chinese page for real

Two requests: worked examples across industries — education, design thinking,
legal among them — and verification that actually covers both languages.

### Where it starts, rebuilt

The section had four audience cards naming *who* might use this. It now shows
*what a unit of work looks like* in six disciplines, each answering the same
three questions: who is in the room, what gets checked, what is left behind.

| | |
|---|---|
| **Legal** | Reviewing an inbound contract against your own playbook. Every deviation matched to the clause it departs from; a clause the system cannot place is flagged, not guessed. |
| **Design thinking** | Getting from twenty interviews to a problem worth solving. Divergence is cheap for agents and convergence is a human judgment — the tool should not blur which is which. |
| **Education** | A student investigating a question they cannot look up. "No answers" is a permission setting on the agent, not a promise; the reasoning path is the artifact the teacher reads. |
| **Finance** | Turning a month of numbers into a decision someone will sign. An unproven assumption is allowed to exist; it is not allowed to be silent. |
| **Research & consulting** | Due diligence on a two-week deadline. The rejected sources are recorded with the reason — knowing what was thrown away is most of what makes a finding trustworthy. |
| **Operations** | A routine process crossing four systems. The case where the harness stops being a design principle and becomes the reason you are allowed to deploy. |

Presented as a proper `tablist`: arrow keys move between disciplines, Home and
End jump to the ends, and only the selected tab is in the tab order so six
panels are one stop rather than six.

**They are labelled as worked examples, not customer stories.** Inventing case
studies would have been the easiest thing on this page to fake and the least
defensible.

### Verifying both languages

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Four of the six behavioural suites ran against the English page only.** Keyboard, interaction, degradation and compatibility never touched `/zh/` — a separately generated document that could have shipped broken tabs or an unreachable menu with nothing to say so. | Every suite is parameterized over both languages. Eleven suite runs now, not seven. |
| 2 | **Found immediately: the compare switch resized the stage by 24 px on the Chinese page** and not the English one. The two captions swap by `display`, and the translations are different lengths. | Both captions share a grid cell, so the taller sets the height; the inactive one is hidden by `visibility` and `aria-hidden` rather than removed. A jump that exists in one language and not the other is precisely what a single-language test cannot see. |
| 3 | **Every `aria-label` on the page stayed English on `/zh/`** — six of them, invisible unless you are using the screen reader they exist for. | `data-i18n-aria`, translated by the generator and counted by the parity gate. |
| 4 | The no-JS check asserted "more than 900 words" against Chinese, which has no spaces — `split(/\s+/)` undercounts it by an order of magnitude. It was measuring the wrong thing and would have passed a nearly empty page. | Each language measured by something it actually has: words for English, Han characters for Chinese. |
| 5 | After moving the captions to `visibility`, the caption assertion still checked `display` — and passed two visible captions as one. | It checks perceivability now: `visibility` plus `aria-hidden`. |
| 6 | Twelve translation keys for the replaced audience cards were left orphaned in the dictionary. | Removed; the parity gate caught them. |
| 7 | `.card__meta` styled only those cards. | Removed; the dead-CSS gate caught it. |
| 8 | Discipline labels at `--t-nano` (10 px): a readable caption in latin, an unreadable one in Hanzi, which carries far more strokes in the same box. | Raised for `:lang(zh)`. |

**All 8 gates green, 11 browser suites across both languages. 149 KB, LCP
248 ms desktop and 1 912 ms on slow 3G, CLS 0, 60 fps.**

### One home for the palette

Preparation for the brand recolour, done before the new logo arrived so the
recolour itself becomes a three-line change rather than a hunt.

The gradient's three stops were declared in **six** places: `base.css`, the
`defs()` builder in `diagrams.js`, the inline `<linearGradient>` sprite in
`index.html` and in `privacy.html`, the social card, and `build-aurora.mjs` as
`rgba()`. Twenty-two further translucent glows, borders and shadows restated
the same triplets by hand to get an alpha. Changing the palette meant finding
twenty-eight sites and shipping two brands on one page if you missed one —
exactly what AGENTS.md forbids as 「同一事实不得声明在两处」.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Four SVG gradients hard-coded the stop hexes. | `style="stop-color:var(--c-N)"` in all four, including the builder. |
| 2 | Twenty-two `rgba()` restatements existed only to apply an alpha. | Channel tokens: `--c-2-rgb: 255 46 115` read as `rgb(var(--c-2-rgb) / .15)`. Chosen over `color-mix()`, which Safari only supports from 16.2. |
| 3 | The social card's three glows still carried raw `rgba()`, and it already loads `base.css`. | Composed from the channels. Re-rendering both cards produced **byte-identical PNGs** — the refactor is provably a no-op. |
| 4 | `build-aurora.mjs` inlined its own copy of the gradient. | It serves `base.css` and reads the tokens. |
| 5 | Nothing stopped the next hard-coded colour. | A gate in `check-css.mjs` fails the build on any brand literal — hex *or* decimal triplet — outside the token block, scanning the pages, the scripts, the stylesheets and the build tools. |
| 6 | The gate had never been seen to fail. | Probed in both forms: an `rgba()` in a stylesheet and a string in a build script. Both went red, with file and line. |

**All 8 gates green, 11 browser suites across both languages. 149.5 KB, LCP
236 ms desktop and 2 088 ms on slow 3G, CLS 0.0007, 60 fps.**

---

## A brand of its own

The logo files never arrived, so the mark is drawn here — four lobes in the
pink/orange the reference described, and the palette moved to match.

### Round 22 — the mark, and what carrying a brand actually costs

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The nav lockup wrapped to two lines at 1280 px** — wordmark below the mark. `.brand__home` was introduced in round 16 to un-nest an `<a>` and given no CSS at all, so it shrank under nav pressure and its inline children wrapped. Shipped to main. | `display: flex` on the lockup. The responsive suite asked "does the nav overflow" and never "is the lockup intact" — different questions, and only the first was being asked. |
| 2 | Each lobe resolved the gradient against **its own** bounding box (the SVG default), so all four came out identically shaded and the mark read as one flat colour. | `gradientUnits="userSpaceOnUse"` across the whole 32×32 box, so the top lobe sits in the orange and the bottom in the magenta. |
| 3 | The mark's path would have been hand-copied into **four documents that cannot share a runtime**: two page sprites, the social card, and the favicon a browser fetches on its own. | `scripts/brand.mjs` holds the geometry; `build-brand.mjs` writes all four and `--check` fails the build when one drifts. |
| 4 | `favicon.svg` carried the palette as literal hexes — a **fifth** declaration, and the one nobody looks at. | Generated, with the colours read out of `base.css` at build time. |
| 5 | `--on-grad` was chosen against a violet third stop that no longer exists. | Recomputed for the new stops: 5.25:1 at worst, up from 4.99:1. |
| 6 | **The new gate's first run caught a live one** — my own favicon, built before the palette swap and still orange/pink/violet. | Regenerated. A gate that has never been seen to fail is a decoration; this one failed on its first outing, on the person who wrote it. |
| 7 | No `apple-touch-icon`: iOS saves a screenshot of the page to the home screen. | 180×180, rendered from `favicon.svg` so raster and vector cannot disagree. |
| 8 | No web manifest: Android's add-to-home had no name, icon or theme. | `assets/site.webmanifest`, generated — name from the page's own `<title>`, colours from the token block. |
| 9 | The two social cards were **492 KB of committed PNG**. The performance budget never saw them, because it measures what the page fetches and no page fetches a social card. | JPEG at quality 92: 123 KB, visually identical. |
| 10 | Changing the brand does not change the card's URL, and scrapers cache by URL. The new mark would never have reached a single shared link. | The same JPEG switch renames the files, so every scraper re-fetches. |

### Round 23 — the things that fail where nobody is looking

| # | Gap | Fix |
|---|-----|-----|
| 1 | `depth: 1` was declared on every page in `build-i18n` and **read by nothing** — the rewrite hardcoded a single `../`. A page two levels down would have emitted 404ing asset paths, with a field sitting right there that looked like it governed them. | `'../'.repeat(page.depth)`. A field that looks authoritative and governs nothing is worse than no field. |
| 2 | The README still listed `og.png` and `og-zh.png`. | Updated, plus the two newly generated files. |
| 3 | `og-card.html`'s own header comment named the PNG it no longer produces. | Updated. |
| 4 | A manifest served as `application/octet-stream` is **ignored entirely** by Chromium, and neither `_headers` nor the test server declared the type. | Both do now. |
| 5 | iOS ignores the manifest's `short_name`, so the home-screen label was the full `<title>`, truncated. | `apple-mobile-web-app-title`. |
| 6 | The wordmark is gradient text, and print drops backgrounds. The nav is hidden on paper — but **the footer carries the same wordmark and is not**, so every printed copy lost the product's name. | Covered by the existing print rule. |
| 7 | Same trap in Windows high-contrast: the gradient is a background image, which the mode drops, while the transparent text fill survives. | `forced-colors` reset on `.brand__name`. |
| 8 | **A suite that threw hung forever.** The browser and the server were still open and nothing tore them down, so node never exited — a failure and a stall were indistinguishable from outside, and I diagnosed two of them as "still running". | The server is `unref`'d, and `uncaughtException` / `unhandledRejection` tear down and exit 1. A 300 s watchdog stops a genuinely stuck await from burning a CI job in silence. |
| 9 | The reporter printed a suite's name only when it **passed**, so a stall left the previous suite as the last line — pointing at the wrong one. | Announced on entry. |
| 10 | The page declares files it never renders — a manifest, a touch icon, a preloaded font, a social card only scrapers fetch. Nothing on screen changes when one of those paths is wrong. | `check-links.mjs`: every local `href`, `src` and og image on all five pages resolved against the filesystem, every fragment against its own document's ids, plus `_redirects` targets. 58 files, 44 anchors. Proved red on a one-character typo and a dead anchor. |

**Still open and honestly so:** the responsive suite's page occasionally closes
mid-run. Three occurrences, not reproducible on demand, no OOM (15 GB free).
Round 23 did not fix it — it made it *legible*: the next occurrence names its
suite, reports whether the browser is still connected, and exits instead of
hanging.

### Round 24 — what the machines are told

| # | Gap | Fix |
|---|-----|-----|
| 1 | The scroll loop's step was `innerHeight * 0.8`, which is **zero before the viewport is laid out** — and `y += 0` never terminates. A latent infinite loop inside the page that no Playwright timeout reaches and no stack trace shows. | A 200 px floor and a hard iteration cap. |
| 2 | The loop's bound was re-read from a live document on every iteration. | Snapshotted. |
| 3 | `page.setDefaultTimeout` governs actions and navigations and **does not reach `page.evaluate`** — the one call that was hanging had no ceiling at all. | `evaluateWithin()` races every evaluate against a deadline. |
| 4 | The crash handler named the suite. The responsive suite is 22 cases. | `r.step()` names the case and the await inside it. |
| 5 | `sitemap.xml` was hand-maintained beside `PAGES` — a **second declaration of what pages exist**. Adding a page would have left it unlisted, silently. | Generated from `PAGES`, `--check`ed. |
| 6 | The JSON-LD block was copied to `/zh/` untouched: the one machine-readable statement the Chinese page makes about itself declared the **English url and an English description**. | Localized. |
| 7 | There is a logo now, and the structured data did not mention it. | `image` and `publisher.logo`. |
| 8 | `og:image:type` was never declared, and the card had just become a JPEG. | Declared. |
| 9 | `twitter:image:alt` was missing — Twitter reads its own, not `og:image:alt`. | Added, and translated. |
| 10 | Nothing checked the sitemap: a `<loc>` pointing at a page that is gone, or a page missing from it, look identical from the site. | Both directions, in `check-links.mjs`. Proved red. |

### Round 25 — the intermittent, root-caused

Three runs had "hung". Round 23 made them legible; this round found the cause.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The failure was **4 of 8 runs**, always in the responsive scroll, at a different width each time. | Soaked instead of re-run. A failure seen once is an anecdote. |
| 2 | First hypothesis — Chromium throttling timers in a hidden context — was wrong: **753 ms for 750 ms requested** across six background contexts. | Measured before acting. |
| 3 | Second hypothesis — the page blocking its own main thread — was also wrong: when the scroll completes it takes **878 ms and records zero tasks over 50 ms**. The page is not slow. | Ruled the site out with numbers, not with confidence. |
| 4 | What was left: a single **async** `page.evaluate` awaiting a page-side `setTimeout`. On a failure it produced no partial progress at all — not slow, never settled. | Driven from Node instead: one synchronous evaluate per step, Node-side waits. **8 of 8 clean, from 4 of 8 failing.** |
| 5 | On the Chinese page the "EN" switch had no `lang="en"` — read aloud in a Chinese voice. The mirror of a fix already made in the other direction, applied one way only. | Both ways now. |
| 6 | `check-html` and `check-links` both asserted that fragments resolve, over different page sets. | Retired from `check-html`; `check-links` covers all five pages. (Removing it broke the `aria-labelledby` rule that shared its id set — caught on the next run.) |
| 7 | `SITE` was chosen in **four places**: the constant, `index.html`, `sitemap.xml`, `robots.txt`. The README documented the duplication instead of removing it. | `robots.txt` joins the sitemap as a projection of the constant. |
| 8 | Nothing held `index.html`'s canonical, hreflang, `og:url` and card images to `SITE`. A canonical tag naming a domain the site is not served from is invisible on screen and costs the entire index. | Gated. The first version of the rule matched anything containing `boardx.us` and flagged the GitHub repo, the app and the developer portal — three different and correct destinations. Narrowed to self-referential metadata. |
| 9 | The README's gate table listed neither new gate and described a rule that had been retired. | Rewritten. |
| 10 | The README's build list still produced `og*.png`. | Updated, with the two new builders. |

### Round 26 — the nav, and a subsystem nothing had ever run

| # | Gap | Fix |
|---|-----|-----|
| 1 | The probe that root-caused round 25 found something worse than the stall: **requestAnimationFrame fires once in a headless context and never again**, because a renderer with nothing asking for frames produces none. Everything in `motion.js` and the diagram scale sync is rAF-driven — the pinned loop scene, the hero parallax, the reading progress and `--dscale` had **never been executed by a single check**. Eleven suites, one whole subsystem untested. | A `motion` suite that forces frames with throwaway screenshots and asserts rAF ticks, `--read` advances, the loop rail marks exactly one current step, and every diagram resolves `--dscale`. Proved red by deleting one line of `initReadingProgress`. |
| 2 | The industry examples — the legal, design-thinking and education cases — sat ten sections down with **no route from the navigation**. | A `Use cases` link. |
| 3 | Which immediately slid the last link **51 px underneath the language switch**. Entirely inside the viewport, entirely unreadable, and green: the responsive check asked "is the nav clipped at the viewport" and never "is the nav legible". | Every visible item in the bar is now checked against every other for overlap. It caught the regression on the first run. |
| 4 | `.nav__links` carries `min-width: 0`, so under pressure it shrinks **below its own content** and links leave their box rather than being clipped — which is why nothing looked wrong to a viewport-edge check. | Documented where it bites, and the bar tightened so it does not. |
| 5 | Two labels were long enough that eight links could not fit, and three of them began with "The". | `The Workspace` → `Workspace`, `In the box` → `Inside`. |
| 6 | My first probe measured the **container** and reported 58 px to spare while its contents overflowed by 51. A container that has been shrunk below its content reports the shrunken width. | Measured every child box instead. The all-clear was the bug. |
| 7 | The fix went into a new `@media` block placed **above** an existing one at equal specificity, so the later block silently won and the padding never changed. Two runs looked like "the fix did not help". | Applied to the rule that actually wins. |
| 8 | Considered a back-to-top control for a 22 000 px page — and rejected it. The nav is `position: fixed`, so the brand is already a permanent route up. | Nothing added. Not shipping the clutter is the finding. |
| 9 | The hero chip broke after the `+` at 390 px, leaving **"AI" alone on the second line**. | `text-wrap: balance`; engines without it wrap exactly as before, so there is nothing to guard. |
| 10 | A screenshot taken after scrolling captured a **nearly blank page** — reveals need produced frames, and headless produces none. The entire visual pass was reading artefacts as design. | Frames pumped before every capture. The same root cause as rounds 25 and 26/1, arriving for the third time in a different disguise. |

### Round 27 — the reader's own text size

WCAG 1.4.4 says text must reach 200% without losing content or function.
Nothing had ever checked it. It failed — **in English only**, because the
Chinese strings are short enough to fit, so a single-language check would have
called it clean. Same lesson as round 21, in a new place.

The cause was never the type. It was every measurement that grows with the
text and is bounded by nothing.

| # | Gap | Fix |
|---|-----|-----|
| 1 | At 200% on a 390 px phone the hero chip, headline and both buttons sat past the right edge — and `overflow-x: clip` makes that **unreachable**, not merely clipped. | Everything below. |
| 2 | The **floor** of `clamp(2.5rem, 6vw, 5rem)` is in rem: 40 px normally, 80 px at 200%, on a 390 px screen. | `clamp(min(2.5rem, 12vw), …)` — the floor is capped against the viewport. Same for `--t-h2`. |
| 3 | `--gutter` had the same shape, so a phone lost 80 px to margins alone. | Same treatment. |
| 4 | `.wrap` is a grid item, and a grid item defaults to `min-width: auto` — it refuses to shrink below its content. It grew to **486 px inside a 390 px section**. | `min-width: 0`. |
| 5 | `.hero__title { max-width: 18ch }` — `ch` scales with the font size, so the measure was 406 px. | `min(18ch, 100%)`. |
| 6 | `white-space: nowrap` on `.btn` makes the label's min-content the grid track's floor, so one button widened the **whole hero column** past the screen. | Labels wrap; the hero track is `minmax(0, 1fr)`. |
| 7 | The footer's `minmax(14rem, …)` floors totalled 38rem — 1216 px at 200%. Capping them with `min()` was not enough: **a track is never smaller than its content's min-content unless the floor is zero.** | `minmax(0, …)`, with the proportions carried by the `fr` units where they belonged. |
| 8 | Every media query was in **px**, so a text-size preference could not move a single breakpoint. | 27 converted to rem — exact at the default size, responsive to the reader's setting. And a thing worth knowing: inside a media condition `rem` resolves against the **initial** font size, not the current one, so a text-only zoom still moves no breakpoint. The nav links wrap instead of overflowing. |
| 9 | Three breakpoints were then declared **twice** — rem in CSS, px in JS — so at 200% the stylesheet stacked a scene the script still thought was wide. | CSS declares `--bp-narrow/stack/scene`; `mq.js` reads them. |
| 10 | The dead-token rule would have called all three dead, because a property read by **computed name** never appears in a `var()`. | It learns the dynamic prefixes from the JS itself, rather than carrying an exception list. |

**And one check that could never have failed.** The responsive suite asserted
`scrollX === 0` after scrolling right — but the page sets `overflow-x: clip`,
so there is nothing to scroll and the value is always 0. That assertion passed
for twenty-six rounds without ever being capable of failing. It now measures
what actually matters: whether any element sits past the right edge.

### Round 28 — the Chinese page, measured for the first time

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The performance budget measured the English page only** — one `goto`, for twenty-seven rounds. `/zh/` is a separately generated document with different text, a different LCP element and different shaping cost. | Parameterized over both. |
| 2 | Measured immediately: the Chinese page is **772 ms slower on slow 3G** (2652 vs 1880) and 140 ms slower on desktop. Inside budget, and invisible until something looked. | Recorded as a number rather than a feeling. |
| 3 | `content-visibility: auto` on the sections is a **real** win — Chinese desktop LCP 380→244 ms, slow-3G 2652→2116. | **Reverted.** The degradation gate rejected it and was right: without JavaScript only 517 of 900+ words were extractable, and 21 elements stayed invisible when a module failed, because a section that never renders never reveals. The measurement is written into the stylesheet so the next person stops in the same place. |
| 4 | The revert cut to the wrong `.footer__grid` and left the rule live **inside a media query**. | Caught only because the suite kept failing after a "revert" — which is the argument for running it again rather than trusting the edit. |
| 5 | Six discipline tabs in a wrapping flex row with `flex: 1 1 auto`: the last row stretches to fill, so they came out four-then-two-double-width. Ragged in English, worse in Chinese where the short labels made the second row read as a different control. | A 2×3 grid. |
| 6 | The copy gate read **two named files**. 496 Han characters lived elsewhere — the 404 page, the social card, `lang.js`, and the `META` block holding every Chinese `<title>` and meta description, which is the first Chinese a searcher ever sees. | It discovers its inputs. 350 → 387 values, proved red on two of the newly covered files. |
| 7 | Its rule needed Han on **both** sides of the punctuation, so a trailing half-width comma closing a Chinese clause went straight through. | Found by writing a probe that failed to fail; the rule now covers the clause-final case too. |
| 8 | The social card's scrim rendered it **near-black**. It is the one image of this brand anybody ever shares, and it showed none of the brand. | Scrim from `.28/.72` to `.06/.52`. |
| 9 | The card's wordmark was plain white while the nav's had become a gradient — a second version of the logo, which is exactly what the brand source exists to prevent. | Same treatment on both. |
| 10 | `ch` is the width of a `0`, so `max-width: 17ch` is far narrower for Han than seventeen Han characters: the Chinese card used the **left 45%** of the frame and left the rest empty. | An `em`-based measure for `html[lang^="zh"]`. |

### Round 29 — the diagrams, and checks that check themselves

| # | Gap | Fix |
|---|-----|-----|
| 1 | `diagram-strings.js` states in its own header that `check-i18n.mjs` fails on a missing diagram key. **It does not.** That file imported `zh.js` and nothing else, so fifty-four keys drawn into the SVGs had no gate at all. A rule with no script is not a rule — this project's own words, in its own repository. | Written. |
| 2 | Most keys are built as ``t(`d.chain.${key}`)``, which no static reader can resolve, so a static gate alone cannot be honest about its coverage. | Static half: both languages present, no key outside a prefix the drawing code uses. Runtime half in the browser. |
| 3 | `t()` falls back to **the key itself**, so a missing string draws `d.chain.memory` into the picture where nothing could see it. | Asserted at runtime; proved red by deleting a key. |
| 4 | My own motion check asserted `scaled === diagrams` — **vacuously true when nothing rendered**, which is precisely the failure it was added to catch. | Against the count derived from the source. |
| 5 | The keyboard suite tabbed a literal **60 times**. The page has 58 focusable controls. Three more and the last of them would have left coverage in silence. | Derived, with headroom. |
| 6 | Its focus-ring rule exempted anything containing `.d-arch__plate` — which passes whether or not the rule that draws the ring still exists. | It measures the plate's stroke. |
| 7 | The suite **reached** the widgets and never **operated** them. A widget a mouse can drive and a keyboard cannot would have passed both the interaction suite and this one. | Enter on an architecture layer, arrows on the compare switch and the discipline tabs, with state re-read after each. |
| 8 | Switching the compare view is silent, while the architecture explorer's equivalent panel is announced. The same interaction, treated two ways. | `aria-live="polite"` on the captions. |

**And two findings that were mine, not the code's.** A probe reported that the
compare switch and the architecture layers carried no pressed state and that
nothing was announced — all three were wrong. The probe asked for
`aria-expanded`; the code sets `aria-pressed`, and `#arch-detail` has been
`aria-live="polite"` all along. A probe that asks the wrong question gives
confident wrong answers, and reading the code was what settled it.

The tabbability count then read a **correct** roving-tabindex tablist as five
missing controls, because `button` matches the selector whatever its
`tabindex` says. Both are recorded here because the alternative was two
plausible "fixes" to code that was already right.

### Round 30 — what happens when things do not arrive

The page turned out to be genuinely resilient. What was missing was coverage —
and three of this round's ten findings are my own probes accusing a page that
was behaving correctly.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Two failure paths were covered — scripting switched off, and one module aborting — and **the one in between was not**: JavaScript enabled and the scripts never arriving, which is what a proxy, a CDN outage or a blocker actually does. It runs on neither the `<noscript>` block nor the module's own code, but on the `html:not(.js)` failsafe, which nothing had ever exercised. | A resilience suite. Proved red by deleting the failsafe: 30 elements stay invisible. |
| 2 | A missing **stylesheet** was never tested. The page is readable unstyled — 2371 words — and nothing said so. | Asserted. |
| 3 | Missing **fonts** and a missing **hero image**: likewise. | Asserted. |
| 4 | `prefers-color-scheme: light`. The site declares `color-scheme: dark`, and nothing verified that a light-preference visitor gets a coherent page rather than dark text on dark. | Asserted. |
| 5 | `forced-colors: active`. There is CSS for it — including the wordmark fix from round 23, which exists precisely because a transparent text fill survives when the gradient behind it is dropped — and **it had never been run**. | Asserted, on the specific failure: text painted transparent with no background image behind it. |
| 6 | A phone **held sideways**. The responsive widths are eleven numbers and all of them are portrait; 640×360 is a real device in a real orientation. | In the suite. |
| 7 | `.scales` was observed at `threshold: 0.25` while every other observer on the page uses 0. **An element taller than the viewport can never be 25% visible** — it is 658 px against a 360 px landscape phone. It happens to work, and was one layout change from silently never drawing its connecting thread. | `threshold: 0`, like the rest. |
| 8 | My probe sampled at **exactly** the failsafe's 1.2 s boundary and reported 30 invisible elements. It looked like a serious defect and was a stopwatch error. | Sample past the boundary, and say so in the code. |
| 9 | A second probe sampled 700 ms after a nav jump and reported two section headings stuck invisible. They were mid-transition. **Twice in one round**, a boundary-timed probe cried wolf. | Settle, then measure. |
| 10 | The first version of the new assertion then accused a working page: with only a font blocked the scripts still run, so below-the-fold content is waiting on the observer rather than broken. | Scroll, then assert — and the suite caught my mistake, which is the argument for writing the assertion into the suite rather than reading a probe's output and believing it. |

### Round 31 — the gates nobody runs

| # | Gap | Fix |
|---|-----|-----|
| 1 | **No CI workflow referenced `apps/home` at all.** Ten gates and fifteen browser suites, every one of them proved able to go red, ran only when a person remembered to type the command. The site merged into `main` behind 24 green checks and not one of them had looked at it. This is `AGENTS.md`'s own rule at the outermost level: a script nothing calls is not landed. | `.github/workflows/home-gates.yml` — static gates on every PR touching the directory, browser suites and the budget behind them. |
| 2 | `check-compat.mjs` existed, was listed in the README's gate table, and **was not in `check-all.mjs`**. It had never run as part of the standard verification. | Wired in. |
| 3 | Nothing ensured the *next* one would be. | A gate on the gates: `check-all.mjs` fails on any `check-*.mjs` in the directory that its own list does not call. Proved red by unwiring `check-compat` again. |
| 4 | `build-css`, `build-i18n` and `build-brand` all have `--check`. The three builders that emit **binaries** had none — edit the card source or the palette, forget to rebuild, and the committed image keeps showing the old brand. **That is exactly what happened in round 22**, where the favicon was generated before the palette swap. | `check-assets.mjs`. Byte-comparing is impossible (JPEG and PNG encoders are not reproducible), so it records a hash of each asset's inputs. Proved red by changing one channel of the pink by 1. |
| 5 | The README quoted the bundler's sizes — "74 KB of sources become 52 KB shipped". Actual: 85.8 → 56.2. **16% stale**, and a second declaration of a number the build already prints. | The numbers come out of the build now, and the README says so. |
| 6 | It also said six render-blocking stylesheets. There are seven. | Corrected. |
| 7 | The browser suite was **one row** in the README's table. Fifteen suites, most running twice for language, and a reader could not tell what any of them verified. | Listed, with what each one would catch. |
| 8 | The web manifest had no `description` and no `lang`. | Both, read from the page they describe. |
| 9 | **One manifest served both languages**, so a Chinese visitor who installed the site got an English name and an English description on their home screen — the one surface where an install prompt shows text, and the only page of the site with no Chinese version of it. | One per language, generated from each page's own `<title>` and description. |
| 10 | The `Content-Type` rule for it was written for **one exact path**. The moment a second manifest existed it would have been served as `octet-stream` and silently ignored — Chromium refuses a manifest without the JSON media type, and nothing on the site would have looked any different. | A glob. |

---

## Where this ended up

Thirty-one rounds. The page is 150 KB over the wire, paints in 272 ms on a
desktop and just under two seconds on a throttled 3G phone, holds CLS at
0.0007, scrolls at 60 fps, and works with no JavaScript, no stylesheet, no
fonts, no images, at a 200% text setting, in forced colors, and in two
languages that are each a real URL rather than a runtime toggle.

The durable lesson is not in any of those numbers. Across thirty-one rounds
the longest-surviving defects were almost never in the page — they were in the
things watching the page:

- a `scrollX` assertion that could not fail, for twenty-six rounds
- a budget that measured one of two languages, for twenty-seven
- a check that existed and was never called, for its entire life
- fifty-four translation keys whose gate was described in a header and never
  written
- and, at the end, **the whole suite, which CI had never run once**

Every gate in this directory has now been watched to fail before being trusted.
That is the only property of a check that actually matters.

### Round 31b — what CI found on its first run

The workflow added ten minutes earlier did the thing it was added for.
`static` went green in 17 seconds; `browser` ran all fifteen suites and then
failed the budget: **`[en] desktop CLS 0.0219 over budget 0.02`**, for a shift
no local run had ever produced.

| # | Gap | Fix |
|---|-----|-----|
| 1 | Every local run measures a **warm font cache** and reports CLS 0. A first-time visitor does not, and neither does a CI runner. The budget could not see font-swap shift at all. | The cold case is measured now: the fonts are held back 400 ms, deterministically, in both languages. |
| 2 | Reproduced, the shift named `brand__tag`, `nav__links` and `hero__title`. My first guess was the `flex-wrap: wrap` added to the nav in round 27. **Measured with it off: identical.** Not the cause. | Isolating the two faces showed Inter at CLS 0 and Outfit at 0.0094 — the display face alone. |
| 3 | `Outfit Fallback` was **5–13% narrower** than Outfit across representative strings ("WorkspaceX" 1.074, the hero headline 1.060, "Architecture" 1.132) while `size-adjust` made it narrower still at 97%. Inter's fallback holds at 0, which is what a metric-matched face is supposed to do. | `size-adjust: 104.2%`, with the vertical overrides divided by the same factor so the line box is untouched. Ratios now 0.97–1.05; the nav stops moving entirely and the shift falls to 0.0055. |
| 4 | `font-display: optional` takes it to a clean **0**. Rejected on the first pass — a first-time visitor on a slow link would read the pitch in the fallback — and **adopted on the second**, when CI came back with the same 0.0219 and the reason turned out to be bigger than CI. See below. |
| 5 | Changing `fonts.css` then made the social cards stale — and `check-assets.mjs`, written an hour earlier in this same round, **caught it**. | Rebuilt and re-recorded. |

### Round 31c — the number that would not move

The corrected metrics went in, and CI returned **exactly 0.0219 again**. A
number that does not move is not noise: it is a deterministic shift, and one
that is English-only — the Chinese page reported 0.

The fallback faces resolve through `local('Arial')`, `local('Helvetica')`,
`local('Liberation Sans')`. If none of them exists on the machine, the
`size-adjust` and the ascent and descent overrides describe a face that is not
there, and the stack falls through to an unadjusted generic. Measured here by
pointing the fallback at a font that does not exist:

| | CLS |
|---|---|
| fallback resolves | **0.0055** |
| fallback does not resolve | **0.0968** |
| the CI runner, resolving something else again | **0.0219** |

The same page, three answers, and which one a visitor gets is not something
this site controls. **Android has none of those three faces.** So this was
never a CI number — it was a real defect for a large share of real visitors,
and it had been invisible because every local run happened to sit at the good
end of the range.

| # | Gap | Fix |
|---|-----|-----|
| 1 | A metric-matched fallback is **conditional on a font the visitor may not have**, and nothing anywhere said so. | `font-display: optional` on both faces: the real face is used when it is ready and skipped for that navigation when it is not, so there is no repaint to shift anything. **CLS 0 in all three worlds**, including the one where the fallback does not resolve at all. |
| 2 | The obvious objection to `optional` is that it costs the typeface. | Checked rather than assumed: the faces are same-origin and the display face is preloaded, and a normal load renders in Outfit — confirmed by looking at the letterforms, because metric matching makes the heights identical and a measurement cannot tell them apart. |
| 3 | Round 31b's fallback metrics might look wasted now. | They matter **more**: under `optional` the fallback is exactly what a slow first-time visitor sees. |
| 4 | Three guesses were made and measured before the right one: the nav's `flex-wrap` (identical with it off), the word-splitting JS (0 px change to the headline box at three widths), and the font metrics (real, but a third of the problem). | Each was tested rather than believed. |
| 5 | Editing `fonts.css` invalidated the social cards again — `check-assets.mjs` caught it a second time in one evening. | Rebuilt and re-recorded. |

Final: **CLS 0 on every configuration in both languages** — warm, cold-font and
slow-3G — where the budget is 0.02.

---

## Rounds 32–41

### Round 32 — the things nobody reads

| # | Gap | Fix |
|---|-----|-----|
| 1 | The hero's second button says **"See how it works"** and pointed at `#shift` — the market-thesis section. The section that answers it is `#loop`, which the **footer has always called "How it works"**. Thirty-one rounds, and the page's most prominent secondary call to action sent the reader to the wrong place. | `#loop`. Found by listing every label that points at each anchor and reading the ones with two names. |
| 2 | The Chinese eyebrow for `proof` read **11** — which is also `open`'s number. The Chinese page ran 01…11, **11**, 13, 14, with no 12 at all. | 12. |
| 3 | **Nothing read those numbers.** The key existed, it was translated, it had Han characters, its punctuation was correct — every gate was happy about a section that told the reader it was the eleventh for the second time. | A number in prose is a fact declared twice: once by the order of the sections and once by the digits. |
| 4 | — | `check-sequence.mjs`, red on its first run on the live bug. |
| 5 | The privacy page carries a **hand-typed "Last updated"** date, and its own closing line argues that its git history is the change log. Nothing kept the two honest. | Fingerprinted rather than derived from git: deriving it makes the check fail between a commit and a rebuild, chasing itself forever. Change the prose without moving the date and it fails. |
| 6 | **Nothing asserted a clean console.** A module throwing after boot or an asset 404ing is invisible to every other suite here — the degradation suite only ever watches failures it caused on purpose. | Five pages, errors, warnings and failed requests. Proved red with one `console.warn`. |
| 7 | No `Strict-Transport-Security`. | Added — without `includeSubDomains`, because this domain does not control what its siblings serve and a promise made on their behalf is one it cannot keep. |
| 8 | No `Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`. | Both, free on a site that loads only its own origin. |
| 9 | **Checked and dismissed.** The eyebrow casing looked badly inconsistent — "The Shift" beside "The workspace" beside "One Workspace", no system at all. `.eyebrow` is `text-transform: uppercase`: none of it reaches a reader. A pointless change, nearly shipped as a fix. |
| 10 | **Checked and clean.** Every number in the prose against the real element counts — "five steps" against the chain's five nodes, "six gates", "five layers", "three scales", all correct. And a length-ratio sweep over 133 translation pairs looking for omitted or invented content: median 0.34, and every outlier turned out to be a short label or a latin brand name. |

### Round 33 — the printed page, and an address for the use cases

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The print stylesheet had been edited three times across these rounds and never once rendered and looked at.** | Rendered. |
| 2 | `.hero::after` paints the dark scrim that holds the headline on screen, and print never removed it. Most browsers drop background graphics — but a reader who ticks "Background graphics", which is a normal thing to do for a page that looks like this, got **black text on a black field across the whole first sheet**. | Hidden in print. |
| 3 | The same reasoning nobody had applied to the glows: a `box-shadow` is a background graphic. | Cleared on buttons, cards and stages. |
| 4 | **Checked and dismissed.** The first print probe reported the evidence-trail items invisible. They sit inside `.surface`, which print hides deliberately — the probe read each element's own `display` and not its ancestors'. Re-measured with `getClientRects()`: nothing is invisible in print, in either language. |
| 5 | **A discipline could not be linked to.** `/#panel-edu` loaded the page with Legal still selected and the education panel `hidden` — so the browser could not even scroll to it. Those six panels are the only place the argument is made in a named profession, and they had no address. | The fragment is read on load and on `hashchange`, accepting either the tab's id or the panel's, because both are in the markup and a reader copying an anchor cannot know which is which. |
| 6 | And choosing one **did not change the URL**, so there was nothing to copy even after finding it. | `replaceState` on selection: the address bar becomes copyable without a history entry per click. |
| 7 | Nothing checked either. | An `addressable` suite per language, including an assertion that choosing a tab does **not** grow `history.length`. |
| 8 | **Checked and clean.** Back and forward across nav anchors restores the right hash. |
| 9 | **Checked and clean.** A chosen discipline survives hash navigation elsewhere on the page. |
| 10 | **Checked and clean.** Resizing into the stacked breakpoint mid-scene keeps the ring and correctly clears the rail's `aria-current`. |

### Round 34 — looking at the diagrams

Eight SVGs, captured in both languages and at 390 px, and looked at.

| # | Gap | Fix |
|---|-----|-----|
| 1 | In the harness diagram the travelling token ran along `y + boxH / 2` — **the line the label sits on**. "Execute" rendered as "ecute", in both languages, on the flagship picture of the argument. | One rail above the gates. |
| 2 | The collision was **already known**. The reduced-motion branch parks the token at `y - 16` with a comment saying to keep it "clear of the last gate's label rather than on top of it". It was fixed only in the branch almost nobody reaches, while the animated path every reader sees kept running through the text. | The two paths share one constant. The comment was never the problem; two positions for one rail was. |
| 3 | The **narrow** variant has always had this right — it runs the token up the gutter. Two implementations of one idea, and nobody ever put them side by side. | — |
| 4 | `.d-label--on { fill: #fff }` paints label text **on the brand gradient**: 2.19:1 over the orange stop, 3.35 and 3.75 over the others. This page solved that exact problem once, for buttons, and named the answer `--on-grad`. The diagram painting on the same gradient never got it. | `var(--on-grad)`: 8.98 / 5.88 / 5.25. |
| 5 | **axe cannot see this.** It does not evaluate SVG text over a gradient fill, so white-on-gradient passed every accessibility run for thirty-three rounds. | — |
| 6 | Nothing else could see it either. | A check in the motion suite: any diagram text overlapping a gradient-filled shape must use the ink token. Proved red — it names "Memory". |
| 7 | Its **first version asked whether the same `<g>` contained a gradient-filled shape**, and reported the axis diagram — whose labels sit above the line and whose only gradient is a 4 px dot at the far end. A group is not a position. | Rewritten as a geometric overlap test, with a 40% threshold. |
| 8 | **Considered and left alone.** The narrow architecture diagram drops the "moves fast" and "must stay stable" brackets, which is the claim its own `h2` makes verbatim. The code says `if (narrow) return; // no room beside the stack; the copy carries this` — a documented decision with a stated reason, and the copy does carry it. Overriding that on my own judgment would not have been a fix. |
| 9 | **Checked and clean.** The architecture explorer's state is exactly `ARCH_IMPACT` at both widths — L3 selected, L4 and L5 impacted, L2 and L1 untouched — and the detail panel follows the selection. |
| 10 | **Checked and clean.** The lit left edge on L2–L3 is the deliberate stable-core marker, not a stuck selection, and the code says so. |

### Round 35 — Han glyphs, and a round that was mostly verification

Two fixes and one gate out of ten items. The defect density is dropping, and
saying so is more useful than padding the table.

| # | Gap | Fix |
|---|-----|-----|
| 1 | The Chinese loop diagram's centre title rendered with a **dark halo around every stroke** — the counters filled in and the character turned into a blot. | Diagnosed, not guessed at. |
| 2 | Root cause: the display face is latin-only, so Han falls through to the machine's CJK font — and this machine's only one is **WenQuanYi Zen Hei, Regular-only**. The engine manufactures `font-weight: 600` by stroking the glyphs. | — |
| 3 | Not every reader sees it: macOS, Windows and Android all ship a bold CJK face. Linux frequently does not, and *"read the repository"* is this product's pitch, so that is not an audience to round off. | `font-synthesis: none` under `:lang(zh)`. |
| 4 | The rule is **strictly safe**: it disables synthesis, never the use of a real bold face. Nobody who has one is affected. | — |
| 5 | **Nothing checked where a diagram label lands.** The existing rule measures how *big* a label is and never its position, so a longer translation or a renamed gate could run past the edge of its own `viewBox` and be clipped with nothing to say so. | Asserted against the `viewBox` at every width. Clean across six language × width combinations. |
| 6 | A fourth blank screenshot out of my own capture tool, which does not pump frames. Recognised in one step this time rather than investigated — which is the only value a recorded mistake has. |
| 7 | **Checked and dismissed.** The break diagram's scattered dots are mid-flight animation particles, not artefacts. |
| 8 | **Checked and dismissed.** The workspace illustration drops 22 elements at 390 px. What it drops is the agent roster, and the stylesheet says why: *"Three columns at phone width would be three unreadable slivers. Keep the canvas and the evidence trail — they are the argument."* Verified the evidence trail is 4 of 4 visible at both widths. |
| 9 | **Checked and clean.** Every diagram label sits inside its `viewBox` at 390, 768 and 1280, in both languages. |
| 10 | **Checked and clean.** The English loop diagram shows no synthesis artefact — which is what isolated the problem to Han glyphs rather than to the style. |

### Round 36 — who tests the tests

Thirteen gates and nineteen browser suites, and none of them had ever been
asked the only question that matters about a test: *does it fail when the
thing it watches breaks?* So ten deliberate defects were injected one at a
time, each one a plausible regression, and the whole suite run against each.
**Eight caught, two missed.** Both misses were real.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **An image can lose its alt text and nothing notices.** | The rule that looked like it covered this — `check-html`'s "images without alt" — guards a population of **zero**: this site has no `<img>` elements at all. The hero backdrop is a CSS background, every diagram is inline SVG. |
| 2 | The only alt text on the site is the **social card's**, and nothing read it. | A card-alt rule in `check-links.mjs`: any page declaring `og:image` must carry `og:image:alt` and `twitter:image:alt`, non-trivially. Proved red on an emptied alt. |
| 3 | Writing it exposed the reason it had never fired: **`privacy.html` had no `og:image` at all.** It declared `og:title`, `description` and `url`, so a shared privacy link previewed as text with a **blank thumbnail** — and `check-links`'s existing og:image rule, which names this file among its three pages, was happily validating a tag that was not there. | The full card added, both languages. It is linked from the footer of every page and named as the policy in `.well-known/security.txt`; it does get shared. |
| 4 | **The language switch can lose its `lang` attribute and nothing notices.** The zh→en half was added in round 25 — a real fix, correctly reasoned, shipped without a gate. | `r.equal(stat.switchLangs, 'en|zh-Hans', …)` in the bilingual suite. A fix with no script is **this repository's own named failure mode**, written into AGENTS.md, and eleven rounds of my own work walked into it. |
| 5 | Eight of ten mutants were caught — a stale generated asset, a broken anchor, a drifted brand path, a wrong section number, a contrast regression, a missing manifest field, a CSP relaxation, a moved breakpoint. The gates that were built defensively, after a real bug, all held. | The two that missed were both rules written **speculatively**, guarding something that was not there. |
| 6 | **My own error, recorded.** I grepped `og:image\|twitter:image` in `privacy.html`, saw nothing, concluded the page had no Open Graph tags at all, and added a complete duplicate block. Caught on re-read; `git checkout` and start again with only the missing tags. The grep answered exactly what I asked it, which was not what I wanted to know. |
| 7 | **The same class of error twice in one round.** Counting og tags with a loose pattern counted an HTML **comment** that mentions `og:title` as a tag — so the file appeared to have a duplicate that did not exist. Twice. Resolved by matching `<meta property="og:title"` precisely. |
| 8 | **The round's own change tripped a gate — correctly in shape, wrongly in scope.** Round 32's privacy-date fingerprint hashed *the whole file* minus the date line, so adding a social-card `<meta>` to the `<head>` demanded a new **"Last updated"** date for a policy whose text had not changed by one word. A gate that forces a false date, in the file whose entire job is keeping stated facts true. | Scoped to `<main>`. Proved both ways: a sentence added to the policy still fails it; a `<meta>` added to the head does not. |
| 9 | **Checked and clean.** The gate on the gates still holds: `check-all.mjs` fails if any `check-*.mjs` exists that its own list does not call. It is the reason a new script cannot be written and then quietly not run. |
| 10 | The generalisation, thirty-six rounds in: **the longest-surviving defects in this work were not in the page. They were in the things watching the page.** A gate written after a real bug is anchored to something that happened. A gate written from imagination guards whatever the imagination assumed — and when the assumption is wrong, it reports green forever. |

### Round 37 — the high-contrast reader

Windows high-contrast mode, measured rather than imagined: two contexts per
language, `forcedColors: active` and `none`, every selected state compared
against its unselected neighbour as a computed signature.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The segmented switch loses its selected state entirely.** In forced colors the on and off halves came back *byte-identical* — same colour, same transparent background, same border, no background image. The control has two states and shows one. | `Highlight` / `HighlightText`. |
| 2 | **The navigation's "you are here" disappears.** The current link and every other link were identical, and the 2px gradient underline under it painted a transparent box. In a mode that drops background images, a gradient indicator is not dimmed — it is deleted. | `LinkText` plus a real underline, and the rule itself given `Highlight`. |
| 3 | **The selected discipline tab paints no marker.** Its 2px nub is the same dropped gradient. | `Highlight` on the nub, `Highlight`/`HighlightText` on the tab. |
| 4 | The reading-progress bar is the same gradient again, and it is the only readout of how far down the page you are. | `Highlight`. |
| 5 | **The stylesheet names this exact trap.** The forced-colors block opens with *"a gradient-filled button becomes invisible text on nothing"* and covers `.btn`, `.langswitch__btn`, `.chip`, `.nav__ghost` — while three more controls styled the same way, in the same two files, were not covered. The same shape as round 34's rail: one idea, implemented in one place, and nobody put the two side by side. | — |
| 6 | **The mode was already under test, asking the wrong question.** The resilience suite has run in `forcedColors: active` since it was written: does anything render, is any text transparent, is anything past the right edge. All three passed on every round while three indicators were invisible. A check can watch the right context and still not be looking at anything. | A suite that asks the only question an indicator has: does the chosen one look different from the others? |
| 7 | **The first version of the fix silently did nothing.** `sections.css` is bundled *after* `components.css`, so its `.cases__tab[aria-selected="true"]` rules won at equal specificity and the new forced-colors rule never applied. It was caught by measuring the result, not by reading the diff — which is the entire argument for the suite above. | The attribute selector repeated, with the reason written beside it. |
| 8 | **My own probe, wrong first.** The first nav measurement ran at the top of the page, where no link is `aria-current`, and fell back to the first link — comparing one unselected link against another, a test that could only pass. | The suite scrolls into a section before measuring, and says why. |
| 9 | **Checked and clean.** SVG is exempt from forced colors: the diagrams keep their real gradients, and `.d-label--on` still measures `rgb(18, 8, 13)` — round 34's `--on-grad` fix survives in this mode, which is exactly where losing it would have hurt most. |
| 10 | **Checked and clean.** `.grad-text` paints through `background-clip` like the wordmark does, but declares `color: transparent` rather than `-webkit-text-fill-color`, and `color` *is* forced — measured `rgb(255, 255, 255)`. The trap that the wordmark needed a rule for does not repeat here. |

### Round 38 — what accumulates

Thirty-seven rounds, and the page had never been run **twice**. Every suite
loads it, exercises it once and closes the context, so anything that grows per
re-wire grew unobserved. Crossing the narrow breakpoint rebuilds the diagrams
and re-wires the loop scene — which is what rotating a tablet, dragging a
window across a monitor edge or opening devtools does, repeatedly.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Every re-wire added another click handler to the same six rail items.** Measured: 6 at boot, **42 after three crossings**, and one click on a step firing **seven** smooth scrolls to the same place. At five crossings, eleven. | The handlers are kept as explicit removers and released at the top of the next wire. |
| 2 | `detachScene` existed and worked — it released the scene's own scroll and resize listeners. It **knew nothing about the rail's**, because those are added by the caller. A teardown that covers what one function allocated, called by a function that allocates more. | — |
| 3 | **`initScene`'s IntersectionObserver was never disconnected.** Twelve created across three crossings, **zero disconnected**. `track` is persistent markup — not rebuilt with the diagrams — so every observer stayed live, holding a closure over a diagram that had already been replaced. | `io.disconnect()` in the detach that was already releasing everything else. |
| 4 | Nothing could have caught any of it: the page was never re-wired under test. | An `accumulation` suite — five breakpoint crossings and 120 clicks — asserting live observers, DOM nodes, svg count, history entries, and that one rail click still scrolls exactly once. Red on the previous code at 11 scrolls and 16 observers. |
| 5 | **My first measurement was wrong, and it accused working code.** A global `addEventListener` tally showed the architecture diagram's rows going 5 → 35 and I read it as a third leak. Those rows are rebuilt on every render: their handlers die with the nodes. A tally of registrations is not a count of live handlers. | The suite counts **behaviour** — how many scrolls one click produces — and says in a comment why the tally was rejected. |
| 6 | The same reasoning saved the observer finding from being over-claimed: observers are counted as `made − disconnected`, which is a live count, not a tally. | — |
| 7 | An `AbortController` would have been four lines shorter. `signal` in `addEventListener` options is Safari 15, and `check-compat.mjs` shows this page still carrying fallbacks for **Safari 14**. One new baseline assumption is not worth four lines — and the reason is written beside the code so the next person does not have to re-derive it. | — |
| 8 | **Checked and clean.** DOM nodes: **937 at boot, 937 after five crossings, 937 after 120 clicks.** The diagram rebuild leaves nothing detached behind it, and the svg count holds at 16. |
| 9 | **Checked and clean.** `history.length` is 2 at boot and 2 after 120 clicks across the tabs, the switch and the architecture layers — round 33's `replaceState` holds under repetition, which is the only condition that could have broken it. |
| 10 | **Checked and did not over-claim.** The obvious story for a leaked observer is that it resurrects a stale animation loop. Measured: rAF callbacks during one scroll nudge were **87 before the crossings and 82 after** — no multiplication. The leak was real; its worst-case story was not, and the log says so rather than telling it. |

### Round 39 — the Chinese page is not the English page with different words

Thirty-eight rounds have verified that `/zh/` says the same things. This one
asks whether it *renders* like a page somebody designed.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **A Chinese reader on Windows got a serif.** Both real faces are latin-only, so every Han character is resolved by the fallback tail — which named PingFang (macOS/iOS), Hiragino Sans GB and `"Noto Sans SC"`, and **nothing that ships on Windows**. Falling off the end lands on `sans-serif`, which on a Chinese Windows is SimSun: a serif face, in a design that does not have one. | `"Microsoft YaHei"` in both stacks. |
| 2 | `"Noto Sans SC"` is the **web font's** name. Linux and Android install the family as `Noto Sans CJK SC` / `Source Han Sans SC`, which neither stack named. The one platform family the list did cover properly was Apple's. | Both names added, plus `"Heiti SC"` for older iOS. |
| 3 | **Nothing on the English page changes when this list is wrong**, which is exactly why it survived thirty-eight rounds of looking at the English page. | — |
| 4 | It is also the missing half of round 35. Synthesis was switched off so Han glyphs would stop blotting — correct, and it leaves headings with no weight at all unless the resolved face *has* a Bold. Microsoft YaHei and Noto Sans CJK SC both do. | The fix from four rounds ago only completes with this one. |
| 5 | Nothing checked it. | `check-css` now requires every `--font-*` stack to name a CJK family for each of four platforms. Red when `"Microsoft YaHei"` is removed: two stacks, named by platform. |
| 6 | **`og:locale` said `zh_Hans`.** That is hreflang's grammar — language-Script — in a slot whose grammar is language_TERRITORY, and the locale lists the social crawlers accept contain `zh_CN`, `zh_TW`, `zh_HK` and no script tags at all. `en` was the same mistake in the other direction. Nothing renders differently, because the card is built on somebody else's machine. | `en_US` / `zh_CN`, with `hreflang` left as `zh-Hans`, which was always right. Two standards, two places, each now saying its own. |
| 7 | Nothing checked that either. | `check-links` validates `og:locale` as `xx_YY` **and** rejects an underscore in `hreflang` — the same confusion is possible in both directions, so both are gated. Proved red. |
| 8 | **Measured, and deliberately not called a defect.** The Chinese page costs about twice the English one to render: FCP **468 ms vs 976 ms** and load **851 ms vs 2025 ms** at 4× CPU throttling. It is not the web fonts — blocking every `.woff2` changes nothing. It is not the scripts — `domInteractive` is ~70 ms for both, and the no-JS gap is identical. It is Han rasterization on a box whose only CJK face is WenQuanYi Zen Hei. An environment measurement, recorded as one. |
| 9 | **Considered and not adopted.** `text-spacing-trim` and `text-autospace` are the modern answer to full-width punctuation, and Chromium here supports both. Applied to a line of Chinese with brackets and full-width commas, the measured result was **88 px against 88 px** — no difference this environment can show. Adding CSS on faith is precisely how round 36's two missed gates got written. |
| 10 | **Checked and clean.** The Chinese copy rules already cover what I went looking for: straight quotes, half-width punctuation between Han characters *and* closing a clause, a missing space where Han meets latin or a digit, three dots instead of `……`. 387 values, clean. And under 6× CPU throttling the pinned scene still holds a 16.7 ms median frame in both languages. |

### Round 40 — the files nobody runs

`_headers` and `.well-known/security.txt` are plain text interpreted by
somebody else's machine. Nothing in this repository had ever opened either.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The security headers were a string in a file no script read.** The Content-Security-Policy, HSTS, COOP, CORP, `nosniff`, the referrer policy, the frame policy and the media type that makes the manifests readable at all — a misspelt header name, a wrongly indented line or a pattern matching nothing would ship green and change nothing visible from here. | — |
| 2 | **Worse: the browser suites ran without any of it.** The test server sent its own two headers and nothing else, so twenty suites exercised a page under a policy the real site does not serve. The strictest thing this site does was the least tested thing in it. | `harness.mjs` parses `_headers` and serves it. Every suite above now runs under the real policy. |
| 3 | **The first run under it failed immediately** — axe-core injects an inline `<script>`, and `script-src 'self'` refused it. Which is the policy working. | The *tool* was changed to load from this origin. The policy was not touched. That is the correct direction, and it is available only once the policy is actually on. |
| 4 | A policy that is sent and ignored looks **identical from the response**. Asserting the header's presence proves nothing about enforcement. | The suite appends a real inline `<script>` at runtime and requires that it does not execute *and* that the browser reports a violation. |
| 5 | Nothing validated the file itself. | `check-deploy.mjs` — the fourteenth gate. It rejects an indented line that is not `Name: value`, a header declared twice, a rule that sets none, and a pattern that matches no file; requires the eight site-wide headers and ten CSP directives; fails if `script-src` ever gains `'unsafe-inline'` or `'unsafe-eval'`; requires the manifests' media type. Proved red four ways. |
| 6 | **`security.txt` expires on 2027-09-22, and nothing was watching.** A date that is correct today and wrong later, with no commit in between — RFC 9116 makes the file invalid the moment it passes, and the address a security researcher is meant to write to goes with it. | Fails when expired, fails thirty days ahead so the fix is a commit rather than an incident, and fails if the date is set **more than a year out**, which the RFC also asks for. |
| 7 | `Canonical` and `Policy` were unchecked. A security contact file naming the wrong host is worse than not having one. | Both resolved — `Canonical` against the single `SITE` constant, `Policy` against the filesystem. |
| 8 | **Checked and clean.** `harness.mjs` promises that the suites skip cleanly when Playwright is absent and that `check-all` stays runnable on a bare checkout. Thirty-nine rounds, never tested. Moved `node_modules` aside: **14 checks pass**, both browser gates skip and print the install line. The promise is real. |
| 9 | **Checked and clean.** `_redirects` was already covered — `check-links` resolves every target — and `robots.txt` and `sitemap.xml` are generated from the same `SITE` constant the new checks read, so none of the three can drift. |
| 10 | The shape of the whole round: every defect in it lived in a file no code reads and no page renders. On a static site, the riskiest text is the text the browser never shows. |

### Round 41 — the map and the territory

The last artefact in this directory that nothing checked was the file that
describes it.

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Two gates were wired in, proved red and shipped without ever appearing in the table that claims to list them** — `check-sequence.mjs` from round 32 and `check-deploy.mjs` from round 40. `check-all`'s gate-on-gates covers the *runner*; nothing covered the *description*. | Both documented. |
| 2 | The suite table said **fifteen**; twenty-one run. Five suites had no row at all: addressable, console, headers, accumulation, forced colors. | All five added, and the count is now derived rather than typed. |
| 3 | **The drift ran the other way too, and it cost a real defect.** The Fonts section named *Microsoft YaHei for Windows* while `base.css` did not — the documentation described a fix nobody had made, and round 39 had to make it. A Chinese reader on Windows got a serif for thirty-eight rounds while the README said otherwise. A README nothing checks is a second, unversioned opinion about the code. | The section now points at the single source and says what happened. |
| 4 | Three more rows described gates as they were, not as they had grown: `check-css` (brand literals, off-scale values, orphan breakpoint tokens, the CJK stacks), `check-links` (card alt text, the two locale grammars), and the browser row. | Rewritten from the scripts. |
| 5 | **"Two generators are run by hand"** followed by one command; **"Three generators"** followed by five. Two wrong counts in one file, four paragraphs apart. | Both corrected — and the second one lists what it counts. |
| 6 | The Layout listing omitted `privacy.html`, `site.css`, `print.css`, four of the eight JS modules, `_redirects`, `.well-known/`, the Chinese manifest, the generated favicon, `brand.mjs` and `tests/` entirely. | Filled in. |
| 7 | Nothing checked any of it. | `check-docs.mjs`, the fifteenth gate. Both directions — a row for a deleted script is as wrong as a script with no row — plus `×2` marking matching which suites run per language, and the prose count derived from the reporters. Proved red four ways. |
| 8 | **My own gate was wrong twice on its first run.** It read the *script* table's header cell as a suite called "script", and it counted `responsive` as per-language because its label is a template literal — it interpolates its own width count and runs once. | Narrowed to the suite table, and to `[${lang}]` rather than to backticks. Written down because the pattern is now four rounds old: the probe accuses working code first. |
| 9 | **The same numbers again in a third place.** `home-gates.yml`'s header comment says "10 道静态门和 15 个浏览器套件… 24 个 check". One round later it is 15 and 21. | The numbers removed rather than updated, and the comment now names the two authorities instead. This repository's own rule: a fact declared twice drifts, so declare it once. |
| 10 | Across these ten rounds the static gates went **10 → 15** and the browser suites **15 → 21**, every one of them proved red before being trusted. This round is the only one whose defects were entirely in prose — and one of them had already been paid for in code. |

---

## Rounds 42–51 — the open-source story, read against the plan

Source: `docs/research/open-source-business-model.md` (v32.2) and its three
iteration logs — thirty rounds of research in a sibling session. These ten
rounds ask one question of the site: **does it say what that plan actually
concluded, and is every word of it true today?**

One rule governs all ten, because the plan's own front matter demands it:
it is marked **研究稿，待人类决策** — a research draft pending human sign-off,
whose decision table D0–D13 lists *recommendations*, not decisions. A
marketing page may state what is **verifiable today** and may state an
intention **as an intention**. It may not turn a recommendation into a
promise. That distinction is the difference between a positioning document
and a false claim, and it is this repository's own rule in another costume.

### Round 42 — "open" is a legal statement, not a tone of voice

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The repository has no LICENSE file.** None at the root, and GitHub's API reports no licence for it. Under default copyright that is *all rights reserved*: a reader may look, and may do nothing else. | Verified against the API rather than assumed: `"visibility": "public"` and no licence field. Public and open source are two different facts, and only the first one was true. |
| 2 | **The site says "Open core. … the source is on GitHub."** That sentence reads as a grant. The repository grants nothing. The site was making a legal claim the repository does not back — the single most consequential untrue sentence on the page, and thirteen rounds of gates had no opinion about it. | The answer now states what is checkable: the repository is public and readable, there is no LICENSE yet, so nothing grants you the right to run or modify it, and we will not call it open source until it is. |
| 3 | **The fix is not mine to make.** Adding a licence is decision **D1** in the plan, recommended as Apache-2.0 and explicitly marked **不可逆**. An agent choosing a licence for a company is exactly the class of action that requires a human. | So the page says what is true and names the missing step, rather than quietly picking one. |
| 4 | The site could not name Apache-2.0 either, for the same reason — a licence name on a marketing page is a promise with a legal meaning. | The gate below refuses any named licence until the file exists. |
| 5 | Nothing connected the page to the repository it describes. The page lives four directories below a repository whose state it asserts, and every gate so far checked the page against itself. | `check-sequence.mjs` — "stated facts that disagree with reality", which is the right file — now walks up to the repository root and checks the licence claims. |
| 6 | **The gate's second direction is the one that will actually fire.** The day someone adds a LICENSE, the page must *stop* saying there is none — a sentence that was true when it was written is precisely the static trace this repository has a named rule about. | Both directions gated, and proved red both ways. |
| 7 | **The first version of the gate was wrong in the way this site has twice been bitten.** It concatenated `index.html` and `zh.js` and asked whether the disclosure appeared anywhere in the result — so deleting it from the English page passed, as long as the Chinese page still carried it. | Per language, in its own file. Proved red by deleting the English sentence alone. |
| 8 | A third direction: claiming **open core** while no licence exists and *without* saying so is now itself a failure, in either language. Silence is how the original sentence got written. | — |
| 9 | **`has_discussions: false`.** The plan's answer to maintainer burnout — 问答去讨论区不占 issue — rests on a forum the repository does not have switched on, with 173 open issues already. Not a site defect; recorded because the site is about to invite people to that repository. |
| 10 | The governing rule of these ten rounds, stated once and applied throughout: **the page may assert what is verifiable, and may state an intention as an intention.** Everything in the plan's D-table is a recommendation awaiting a human. None of it ships as a promise. |

### Round 43 — the section answered a question nobody asked

| # | Gap | Fix |
|---|-----|-----|
| 1 | **`#open` was a make-vs-buy chart.** *Build / Adopt / Integrate* — "what we must own", "proven infrastructure", "kept replaceable" — is an engineering decision about dependencies. A reader asking what is open and what they pay for got an answer to a different question, in three neat columns. | Replaced with the plan's actual split. |
| 2 | The plan's dividing line is about ownership and money, not construction: **凡是让我们成为中立工作层的，开源；凡是随客户积累的，售卖。** That sentence had no home on the site. | It is the section's lead and its keyline now, in both languages. |
| 3 | **The plan's own central correction was missing: there are three piles, not two.** v32.1 records it as a 分类错误 — a category of thing that is neither open-sourced nor sold, because it is never delivered at all: the coordination plane, the deploy console, the incident board, the agent fleet, CI metrics, the key-rotation ledger. Squeezing it into the first two buckets "得出两个都错的结论". | A third column, **Not delivered** — ours to run, never yours to buy. Most vendors never name this pile; naming it is the honest part. |
| 4 | Every item in the first column is now a real thing from the plan's OSS row rather than an abstraction — runtime, harness and evidence, context engine, model routing, sandbox and local desktop, the format spec. "Ontology & context" was a category; "Context engine" is a component someone can go and read. | — |
| 5 | **I put an undefined acronym on the page.** The first draft of the column read *"MAAU runtime"* and *"The MAAU format spec"* — a term that appears nowhere else on the site, is never expanded, and which the source plan itself flags as **一词两义**, two meanings inside the repository, unresolved. Shipping a company's internal vocabulary to its customers. | Plain words: "the work-unit runtime", "the work-unit format spec". |
| 6 | It was caught by **rendering the section and looking at it** — the method that found the diagram defects in rounds 33 and 34, and a method that does not scale. | A rule in `check-copy.mjs`: a bare acronym is a problem unless a reader can be expected to know it, or the page expands it somewhere. The allow-list is deliberately short and boring. Proved red by putting the term back. |
| 7 | **It immediately found two more that had been there all along.** `CDN` and `WCAG`, both in the privacy notice — a page whose entire value is being understood by a non-specialist. | Split on judgement, not uniformly: "a font CDN" became "a font service run by somebody else", because that sentence exists to be understood. |
| 8 | `WCAG 2.1 AA` stays, and is allow-listed with the reason written beside it: in an accessibility statement the standard's name **is** the precision, and spelling it out would be less exact, not more. A gate that cannot be argued with produces worse copy than no gate. | — |
| 9 | **The privacy date gate fired, and this time it was right.** Changing the `CDN` sentence changed the policy's prose, so round 40's scoping — fingerprinting `<main>` rather than the file — did exactly its job: silent for a `<meta>` tag in round 36, red for a word a reader can see. Re-dated to 2026-09-23. |
| 10 | **Checked and left alone.** The first column's items describe an intention, not a shipped licence — so the section deliberately does not say "open source", and the licence disclosure from round 42 sits two sections away in the FAQ. Round 42's gate holds both languages to that. |

### Round 44 — what happens when you stop paying

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The plan's single most valuable commitment was not on the site at all.** It calls 退出自由 — exit freedom — *"相对 Copilot 与飞书的核心差异"*, and then says it *"一直只停在暗示"*: only ever implied. Decision **D11** recommends writing it out, on the grounds that unwritten it has no sales value. The site did not imply it either; it was simply absent, and the word "lock-in" appears nowhere on the page. | Four clauses, in both languages, in the section that is about exactly this. |
| 2 | **A promise whose status is hidden is not a promise.** Three of the four clauses are not fully real today, and publishing them flat would have been the same class of untruth as round 42's "Open core". | Each clause carries its own status line, in the reader's own view, not a footnote. |
| 3 | Clause 1 — *the open part keeps working* — is **blocked on the licence**. Round 42 established there isn't one, so today this is an intention and not a right, and the page says so in those words. | — |
| 4 | Clause 2 — *your data comes out whole* — checked in the repository rather than copied from the plan: `files-export.controller.ts` runs per-artifact export jobs, and **no whole-workspace export exists**. The plan's own 90-day schedule puts it at weeks 5–7. | "Partly built. Individual artifacts export today; one command for the whole workspace does not exist yet." |
| 5 | Clause 3 — *a written way down* from hosted to self-hosted — the plan lists the migration playbook under 接缝 as **未设计**. | Said as "not built", not smoothed over. |
| 6 | Clause 4 — *we do not switch anything off* — is the only one that needs no engineering: it is a rule about our own conduct. It is therefore the only one stated flatly, and it carries the plan's **EE 切线只进不退**: what is open stays open. | — |
| 7 | **Rendered, all four statuses looked the same.** One pink dot for "In force" and for "Not built" alike — four different answers drawn identically, losing the one distinction the block exists to make. | Two states: solid for live, a hollow ring for planned. Colour is reinforcement, never the carrier — every line says its status in words (WCAG 1.4.1). |
| 8 | **A contradiction I had just created.** FAQ a1 said deployment is *"not a different edition with features removed"* — written before round 43 put SSO, audit, multi-tenancy and compliance export in a column headed **Sold**, two sections above it. Location and edition are different axes, and a reader who has just read that column will merge them. | a1 now separates the two: the same code everywhere, and what the commercial edition adds is the governance layer — which you can also run yourself. |
| 9 | **Checked and clean.** The licence's absence is now stated in two places, the FAQ and this block, which is the shape this repository has a rule about. Round 42's gate is per **file**, not per sentence, so both are covered: adding a LICENSE fails the check until every statement of its absence is updated, in each language separately. |
| 10 | **Checked and clean.** Two columns at 1280, one at 390; item heights equal within each row in English, and the Chinese block is shorter, as Han copy is throughout. |

### Round 45 — the gatekeeper, who holds the veto and was never spoken to

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Six questions in the FAQ, and none of them theirs.** The plan puts 机构 IT 与安全 among the three roles with a veto, and says they are *中国市场开源的全部理由* — the entire reason to open the source in that market. Every question on the page was a buyer's or a user's. | Two questions written for the person who can stop the purchase. |
| 2 | **`SECURITY.md` still said `<安全联系邮箱，待填>`.** The site publishes `security@boardx.us` in `/.well-known/security.txt` and tells researchers to report responsibly; the repository page they land on carried a placeholder. One address, two files, nothing holding them together. | Filled, and gated. |
| 3 | `check-deploy.mjs` now walks up to the repository root: if the site publishes a contact, `SECURITY.md` must exist, must not carry a placeholder, and must name the same address. Proved red by putting the placeholder back. | — |
| 4 | **Zero egress is the strongest thing in the local story and the site never said it.** The plan's own words: 零出网是卖点却不可见. `local-egress-guard.ts` has been shipping and enforcing it the whole time. | A question answering what actually leaves the machine. |
| 5 | The claim had to be written **exactly as narrow as the code makes it**, because the source file itself warns that a reader assuming the broader claim would be misled. So: it patches the one call every outbound connection passes through — a vendor SDK's telemetry and a beacon in a transitive dependency are refused like our own code; a machine on your own network is still another machine and is refused; and outside a local-only workspace, normal traffic is normal traffic. | The narrow claim is the true one, and it is stronger than the vague one. |
| 6 | **The security-review answer had to be checked, not written.** No releases exist — verified through the API, `[]` — so there is no signed release with a bill of materials, and no offline patch bundle for an air-gapped install. | The answer says what exists (public source, plus a dependency licence inventory and a credential scan you can run yourself) and what does not, rather than implying the rest. |
| 7 | **Round 43's acronym gate caught round 45's own copy on its first run.** "TCP", twice, in an answer written for a security reviewer. | Judged, not reflexed: `WCAG` was allow-listed two rounds ago because in an accessibility statement the standard's name *is* the precision. `TCP` is not a citation — the sentence reads better without it. Copy changed, allow-list untouched. |
| 8 | The `#trust` section is about whether an **agent** can be audited. Procurement security is a different question from a different person, and the page had been treating them as one. | They now sit apart: the section argues the runtime, the FAQ answers the reviewer. |
| 9 | **Checked and left alone.** `SECURITY.md`'s response times (3 working days to first response, 10 to triage) match the plan's commitments to security researchers, so nothing needed reconciling — the one place the repository was already ahead of the site. |
| 10 | **Checked and clean.** The two new answers keep the FAQ's own shape: a question in the reader's words, an answer that names what is not true as plainly as what is. Eight entries now, both languages, 335 keys in sync. |

### Round 46 — the person who never signs in

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The site spoke to everyone except the person the work is for.** Buyers, operators, engineers, and after round 45 the security reviewer — but not the investment committee, the partner, the client who is handed a document and has to decide. The plan singles this out as the role earlier versions *完全漏掉*, and notes they **从不登录产品**. | A block at the end of the trust section, addressed to them. |
| 2 | **The plan's sharpest sentence in this area is about the gap between having a thing and showing it:** *Context Engine 有血缘，但报告里没有呈现设计——能力存在不等于体验存在.* The site made exactly that mistake: it argues lineage as a property of the runtime, and never as something a reader touches. | The three requirements are written as requirements **on the artifact**, and the copy says so: not on the runtime. |
| 3 | Their biggest obstacle, per the plan, is 分不清哪些是 AI 生成、哪些有证据支撑. | "You can tell what was generated" — marked in the document itself, not in a settings page nobody opens. |
| 4 | 每条结论可追溯到原件 — and the useful corollary the plan implies: a conclusion that cannot be opened is itself a finding. | "Every claim opens to its source." |
| 5 | 置信度与不确定性显式呈现. | "Uncertainty is shown, not smoothed" — with the reason, which is the part that persuades: a document with no visible doubt is *less* trustworthy, not more. |
| 6 | **Honesty check.** The plan lists evidence presentation under its gaps as **缺规范与实现** — neither specified nor built. Writing these as shipped features would have been round 42's mistake again. | They are stated as a standard we design to, in one sentence, without a third status block: *"a result that cannot meet them is not finished."* Two status blocks on one page is a list of excuses; a standard is a commitment. |
| 7 | **A contradiction with a decided position, found while nearby.** `unit.p4s` offered pricing "per task, per seat **or per outcome**" as three equal options. The plan's D9 puts the meter on task and work-unit usage with seats as an entry point — and states flatly that **outcome pricing is structurally incompatible with self-hosting**: it can only ever exist in hosted and enterprise contracts. | Rewritten: task and work-unit, seats as a way in, and outcome pricing only where we run it. The sentence now survives contact with the open-source story two sections below. |
| 8 | That is the same class of defect as round 44's edition-versus-location: two true-sounding sentences, written at different times, that a reader passing through the page in order will merge. | — |
| 9 | **Checked and clean.** The new block reuses `.prop`, the component the unit section already uses for a claim-plus-reason triple, so it inherits the gradient rule and the responsive behaviour rather than introducing a fourth way to draw a list. 221 classes, all referenced. |
| 10 | **Checked and clean.** 343 keys in sync across both languages; the Chinese block keeps the register of the English — plain, second person, no marketing adjectives — which is the thing 133 translation pairs were swept for back in round 32. |

### Round 47 — which layer this is a bet on

| # | Gap | Fix |
|---|-----|-----|
| 1 | **The site never named the market it is in.** "Copilot" appeared in `index.html` exactly once — inside an HTML comment I had written in round 44. Not one visible sentence placed the product against anything. | The layer, named. |
| 2 | The plan is explicit and the site was silent: WorkspaceX sits in the **AI workspace layer**, alongside Copilot, Glean, Lark and DingTalk — *not* the agent-infrastructure layer beneath it, which already has plenty of open projects. | — |
| 3 | And the punchline that makes the whole section mean something: **这一层没有一个开源的** — there is no open option in this layer — so **开源是楔子不是入场券**. Thirteen rounds argued *what* is open without once saying why being first to do it matters. | The paragraph sits **above** the three columns: the why belongs before the what. |
| 4 | **The sentence had to stop short of the obvious claim.** Until a licence exists (round 42), WorkspaceX is not the open one either. So it says that opening this *is a wedge* and points at the licence question further down the page, rather than awarding itself a crown it has not earned. | The two rounds now hold each other honest in the reader's own path down the page. |
| 5 | Reused `.lead` rather than inventing a class, which rounds 32–41 deliberately made expensive. | — |
| 6 | **Round 32's bug class, again, and found by hand again.** The nav called this section "Open"; the footer called it "Open ecosystem"; the section itself had been renamed to "What is open, what is sold" in round 43. One destination, three names, none of them checked. | Footer label fixed in both languages. |
| 7 | Nothing had ever compared the names given to a destination — round 32 caught its version by listing labels by hand, and then the list was thrown away. | A rule in `check-links.mjs`: an in-page anchor given more than one name is reported. |
| 8 | **The rule was wrong twice on its first run, and reported eight.** "Trust" and "Trust & evidence" are not two names — one contains the other. And "See how it works" is a **call to action**, not a label: the hero is prose, while the nav and the footer are the two places that *name* a destination. | Narrowed to nav and footer, and tolerant of one label containing another. Buttons excluded, with the reason written down. |
| 9 | **It then found two genuine ones that had been there since the site was built.** `#loop` was called "The Loop" in the nav and "How it works" in the footer; `#capabilities` was "Inside" and "What is in it". In both languages. | Aligned to the section's own name. |
| 10 | The shape of this round: one strategic sentence the site had never said, and two label pairs nobody had put side by side. Both are the same failure — **a fact that lives in more than one place drifts**, whether it is a number, a licence, or the name of a section. |

### Round 48 — the questions asked in the room, not on the page

| # | Gap | Fix |
|---|-----|-----|
| 1 | **"Do you train on our data?" was not on the page, in either language.** It is one of the first two questions in any enterprise evaluation, the plan answers it flatly — 默认不用于训练，要用必须明示并单独授权 — and the site said nothing at all. The word "train" appeared once in the whole file, in an unrelated sentence about design research. | Answered, and answered as what it is. |
| 2 | The answer refuses the usual dodge. Not a setting to go and find, not a clause in terms accepted once: **a specific ask and a specific yes**. And it ends by telling the reader that a sentence on a marketing page is not what should satisfy them — ask for the contract. | A commitment that points at its own enforcement mechanism is worth more than one that asks for trust. |
| 3 | **"What does the free tier get?" was also unanswered**, and the plan's position here is unusual enough to be worth saying: 免费层功能完整但配额有限. The whole product, less capacity — not a demonstration with the useful parts taken out. | — |
| 4 | The sharpest clause is the failure mode: **超配额降级到小模型，不断服务.** Running out of quota drops you to a smaller model rather than stopping you, because a task that halts halfway is worse than one that finishes less well. | Said in those terms, with the reason, because the reason is the part that is believable. |
| 5 | And it closes the loop with round 43: what the paid tiers add is capacity, hosting, governance and methodology content — *the three columns above*, rather than a second, unrelated list. | The page now argues one split in two places instead of two splits. |
| 6 | **Nobody had written down what happens to the junior analysts.** It is asked in every real evaluation and it is the plan's own conflict pair 分析师 ↔ 被替代的初级分析师, with a designed answer: 把初级分析师设计成复核者而不是被替代者. | Answered without a slogan. |
| 7 | That answer also had to avoid the two easy failures — pretending the question does not exist, and promising it has no downside. It does neither: it says the outcome depends on how you deploy it, states which side the design has taken, and says plainly that it will not claim there is no cost. | The strongest argument for it is self-interested, and therefore credible: the evidence chain only means something if a named person is answerable for it. |
| 8 | **Checked and clean, and it was already right.** `privacy.html` opens by saying it covers *the website you are reading, not the WorkspaceX product*, and offers to answer product questions in writing. Nothing to reconcile — the page had drawn its own boundary before I went looking for it. |
| 9 | **Checked and clean.** All three answers are commitments rather than shipped behaviour, and every one names itself as such in its own text — after four rounds of this, the page's honesty about status is now a consistent voice rather than a device used once. |
| 10 | **Checked and clean.** Eleven FAQ entries, 350 keys in sync. The new Chinese keeps the register — plain, second person, no adjectives that would not survive translation back. |

### Round 49 — the invitation, narrowed on purpose

| # | Gap | Fix |
|---|-----|-----|
| 1 | **"Read the repository" is the site's only word about participation**, and it is accurate as far as it goes. The question is what happens to the reader who acts on it and wants to help. | Answered, in the one place that makes the offer. |
| 2 | What they find, checked rather than assumed: **no `CONTRIBUTING.md`, no pull-request template, no issue templates, Discussions switched off, 173 open issues**, and — the one that matters most — **zero issues labelled for newcomers**. | — |
| 3 | The `good first issue` label *exists*, which is exactly the trap this repository has a rule about: GitHub creates it on every repository, and the API reports `totalCount: 0` carrying it. **A label is a static trace; the issues under it are the live fact.** Reading the label alone would have produced a sentence that was true about the settings page and false about the project. | Queried the issues, not the labels. |
| 4 | **The marketing instinct here is a "Contribute" button, and it is the wrong one.** The plan's pre-mortem ranks the most likely failure first and it is not lack of interest: **维护者先走** — the maintainers leave — with the early signal being unsorted issues piling up. Maintainer experience is listed as a first-class design constraint, not an afterthought. | The opposite of a call to action. |
| 5 | Inviting contribution before the machinery exists also breaks the one contributor promise H1 actually makes — to the **first-time contributor**: a 15-minute local setup, a fast verification path, and a rejection that explains itself. None of those exist yet. | Saying so keeps the promise instead of failing it at scale. |
| 6 | And 拒绝方式决定口碑 — most contributions to a project shaped like this get declined, so with no guide the rejection is the first and last thing a contributor experiences. | — |
| 7 | The note therefore narrows rather than widens: reading is the invitation; contributing is not open yet; here is exactly what is missing; and when it opens it will be **because those are ready, not because it sounded welcoming**. | It costs nothing, because the real offer was always the readable source. |
| 8 | **My own slip, caught by a gate.** I wrote the CSS for the note before the markup landed — the insertion failed on an indentation mismatch — and `check-css` immediately reported `.proof__note` as a class defined and used nowhere. The gate that has been flagging dead CSS for forty rounds caught a half-applied edit in under a second. | Reinserted against the real markup rather than my memory of it. |
| 9 | **Checked and clean.** The note sits below the button at `--t-small`, narrower than the claim above it, because it qualifies that claim rather than competing with it. |
| 10 | **Checked and clean.** 351 keys in sync. The Chinese says the same uncomfortable thing — 把那几个还在回消息的人埋掉 — rather than softening it, which is the failure mode a marketing translation usually has. |
