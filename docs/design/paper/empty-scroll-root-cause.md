# Empty Chat opening: second-run root cause and local proof

The authenticated run [37157096023](https://github.com/boardx/workspacex/actions/runs/37157096023) tested source `fef7d3fbdcbb5bb0f7236f3f47e0d5d029b86e03`. Its complete-bounds assertion failed on the 375 × 812 light viewport. This is a failed attempt, not visual acceptance.

The captured pane starts at (16, 106), measures 343 × 366, and has scrollHeight 413 and scrollTop 47. The title starts at y=87, 19px above the pane. The empty content is 389px tall plus 24px pane padding. Resetting the captured scroll offset to zero puts the title at y=134 and all four templates within the pane. The desktop CSS correction therefore solved desktop fit but did not address empty content being automatically pinned to its bottom on mobile.

We decoded only the failure trace DOM and captured styles/fonts for a local layout reconstruction. Scripts, event handlers and external document resource links were removed; no trace scripts or API calls were executed. The reconstructed screenshot reproduces the clipped title. Private trace and raw DOM remain outside the repository and are not delivery artifacts.

The correction adds an optional `followContent` flag (default true) to the existing timeline hook. The existing exact empty-thread decision disables message/ResizeObserver automatic following and initializes that branch at scrollTop zero. Loading, running, supplied stream slots and nonempty messages retain the existing behavior. User scroll handlers, explicit jump and nonempty pin-to-bottom logic remain unchanged. The scrollTo availability guard keeps DOM-light renderers supported.

## Reproduction

From the repository root:

```sh
pnpm --filter web exec playwright test --config playwright.paper-layout.config.ts
```

This bounded browser configuration starts no web server, API or database. Its fixture bundles the real hook and TaskWorkbenchEmptyState with the actual Tailwind styles and packaged Chinese fonts. The pane reproduces the captured mobile dimensions. Before the hook correction the opening counterexample failed (`scrollTop` 43 rather than 0). After correction all four tests pass:

- Empty opening: title and all four templates fully inside the pane; content ResizeObserver growth does not scroll it down.
- First message, streaming growth, ResizeObserver, clear, restored thread and new thread preserve the expected scrolling transitions.
- Upward reading survives streaming and resize until explicit jump; subsequent deltas follow again.
- Existing small-overflow upward-intent regression passes with the hook default behavior.

The fixture checks bounded render counts and waits for actual Chinese fonts. It does not inject a scroll reset to satisfy the assertions. The local screenshot was visually inspected: the title and all templates are complete. This proves the local correction, not authenticated application acceptance. A new frozen-source remote run and the full actual Home/Chat light/dark desktop/mobile screenshot matrix are still required.
