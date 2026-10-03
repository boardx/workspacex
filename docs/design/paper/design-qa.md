# PAPER implementation and design QA

Result: **blocked** for full product acceptance. Login and shared primitive evidence is verified; authenticated Home/Chat evidence is missing.

## Source and ownership

Selected reference: Library `libfile_aa6b1d863c688191a6c92d6b701b0013`, actual 1024×1536 PNG in `reference/paper-selected.png`. SHA256: `47b083f6e7cae51595835b226ba8600188d77de1fa6658085fb3a4ba6029cc2f`. Official transfer failed twice; user supplied the identical selected concept locally, then its pixels were inspected before implementation.

Independent worktree: `codex/paper-design-system-20261004`, based on `aa861b3f8266004afbd4f17dd5dfc47798be662a`. Shared root's staged/dirty files were preserved. One implementation writer; read-only reviewer. Marketing owner authorized only CSS semantic/brand variables and their generated bundle. No Board, digital-human or organization-management workflows were edited. Merge belongs to the designated coordinator; no deployment performed.

## Visual comparison

The reference and actual screenshots were inspected together. Reference is a three-screen concept composite, not an exact browser viewport: login frame about 968×546; actual viewport 1024×600 with full-page capture 1024×698. Actual desktop keeps equal columns, a 336px form, warm paper background, thin frame, black primary action, muted rose links and the original pink/orange brand. Extra height is retained for the real invitation/security explanation and original animated brand asset. The animation screenshot is one frame, not a replacement static butterfly.

Mobile login at 375×812 has scroll width 375, retains every field and invitation explanation. Desktop and mobile Dialog screenshots verify viewport gutters. Repeated cancel/Escape closes and returns focus to the trigger. Light→dark→light toggle works on the existing development gallery. This gallery has explicit sample identities/data and is only primitive evidence, not authenticated Home/Chat acceptance.

Home preserves organization logo palette extraction, configured quick actions/sections, banner presets/images and permission boundaries. Chat preserves task templates, context/memory/skills/materials, models and message logic. Their spacing/type/composer changes are source-reviewed and unit-tested, but screenshots and real long Chinese conversation/scroll/runtime interactions remain blocked by the absence of a verified API login environment. No bearer tokens were moved between origins; no API/DB/Docker stack was launched.

## Coverage and exceptions

`node apps/web/scripts/audit-paper-coverage.mjs` produces `coverage.json`: 131 routes, 706 components; all routes inherit global tokens, 114 statically reach shared primitives. 539 files are conservative exception candidates (categories overlap): 6 scoped themes, 159 authored-content candidates, 430 literal-color candidates. This is import/token coverage, not browser coverage or a completed color audit. Comments and content literals may be candidates. Board/canvas/chart/avatar and authored diagram colors remain intentional; no mass literal replacement. Marketing retains its established dark artistic canvas with matching warm-dark semantics and brand hues; original copy, motion and diagrams remain intact.

## Validation

- Web TypeScript `tsc --noEmit --incremental false`: passed (empty log means zero diagnostics).
- Six representative suites: 55/55 tests passed (theme, overlays, resource card, login/signup, Projects, create-project).
- After scoped destructive-hover preservation, theme suite rerun: 4/4 passed.
- Token contrast: 48 foreground/background pairs including explicit hover states passed. This does not certify user-authored arbitrary palette colors.
- Generated light scope: 53 tokens match root.
- Scoped design-system lint: passed; `git diff --check`: passed.
- Marketing generated CSS and static CSS compatibility checks: passed. Actual 1024×600 screenshot retained.
- Exact-diff independent review: no actionable regressions in initial source review; final additive review recorded separately.

Dev gallery console reports an existing ThemeToggle Radix Slot/function-component ref warning. This file was not modified. Theme toggling and Dialog focus return succeeded, but the warning is not hidden or claimed fixed.

Local git hooks were skipped for the authorized lightweight commit path; heavy build/DB checks are deferred to repository CI. PR remains draft until CI and authenticated Home/Chat visual verification complete.

## Remaining verification

Use the repository's isolated full-stack CI/browser path (harness-verify/backend-gates), not production pages as evidence for this local branch. Capture actual `/home` and `/chat` at 1024px and 375px using legitimate same-origin login, then check model/context menus, long Chinese text, stream/scroll, repeated actions, cancel/back and organization-logo override. Verify remaining route exception candidates by priority. No credential or permission workaround is authorized.

Screenshots are under `screenshots/`; selected reference is under `/reference/`. Final result remains **blocked**, not “whole site passed”.
