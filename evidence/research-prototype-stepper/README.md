# Shared timeline verification — issue #4440

Browser: Codex in-app browser only. Viewport: 1448 × 1022, matching the reference content area after excluding browser chrome.

The real `/research/new` route, not the legacy preview fixture, was rendered from this worktree on localhost:25539.

## Verified

- `import-before.png`: unavailable stages inherited rectangular disabled button backgrounds.
- `import-after.png`: unavailable stages are non-interactive circular indicators; unlocked stages retain navigation semantics.
- `unsaved-guard.png`: entering text then selecting Return to research list opens the discard dialog. Selecting Continue editing retains the text.
- Workspace navigation is absent inside the research route.
- Targeted reference-layout suite: 10/10 passed, including an observed failing test before implementation.

## Not accepted as full prototype fidelity

This is a shared-timeline correction, not seven-screen completion. Intake typography/card sizing, reference artwork, profile header, file/voice availability, and all other screens still require paired visual review. The intake currently also requires a topic under the supplemental-information disclosure before continuing; this is a remaining flow difference.

No standalone Playwright browser was used. No merge or auto-merge was performed.
