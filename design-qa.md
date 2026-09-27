# Interview prototype acceptance

final result: blocked

## Source visual truth

The eight user-provided grayscale screenshots, beginning with `/var/folders/l8/7z3_dshd7799phy86_sry5k40000gn/T/codex-clipboard-f966283d-98d3-41b1-acde-25c756e7eb02.png`, define the list, intake, analysis, experts, virtual-expert modal, questions, execution and report states. Fixed SVG avatars are an explicitly requested deviation from photographic reference avatars.

## Browser evidence limits

- Implementation: local branch `codex/interview-prototype-completion`, draft PR #4486.
- Native browser opened `http://localhost:3000/itv/new` and redirected to `/login?next=%2Fitv%2Fnew`.
- Observed viewport: 1280 × 720. The captured state is login, not an interview page.
- Implementation interview screenshot path: unavailable; no accepted interview capture saved.
- Source/implementation pixel normalization, full-view and focused-region comparisons: not performed because the states do not match. No pixel-fidelity conclusions are made from code or the login screenshot.
- Primary interview interactions, console errors and all eight target states still need browser acceptance using an authenticated isolated API stack.

## Confirmed functional findings and fixes

1. Queued expert tasks were labeled active. Regression failed before the fix; pending tasks now show 等待访谈. Related 32 UI tests pass.
2. Three new RLS policy migrations failed on forced replay. Policy recreation now preserves tenant restrictions; real isolated migration checks rebuild 322 migrations and verify schema/data equality after replay (exit 0).
3. Navigation reachability did not recognize the conditional creation route. Explicit scoped/default router branches preserve navigation behavior and pass the gate.
4. Two CI browser cases retained obsolete legacy fixtures for canonical routes. Fixtures and assertions are updated while preserving avatar persistence/reset, responsive checks, six-step navigation and legacy Skill coverage. Actual browser rerun remains required.

## Remaining acceptance

- Capture the list, all six stages and the virtual-expert modal at matched desktop sizes.
- Compare typography, spacing/grid, grayscale tokens, icons, content hierarchy and responsive reflow against reference images in combined comparison inputs.
- Verify header navigation, return-list menu restoration, reload persistence, editable avatars, upload/voice failure recovery and Markdown-only content paths.
- Re-run current-head browser CI and resolve every genuine failure/review before removing Draft.

No assertion of complete one-to-one reconstruction or merge readiness is made.
