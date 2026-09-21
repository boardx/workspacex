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
