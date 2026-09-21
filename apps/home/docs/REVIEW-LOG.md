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
