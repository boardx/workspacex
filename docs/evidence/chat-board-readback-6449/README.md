# PR #6449 Board transport readback isolation

Review thread: PRRT_kwDOO5_Nyc61EGGF.

Board handoff sources now have a reserved `[board-transport] ` title prefix. Ordinary diagram/canvas readback excludes them before selecting the latest eligible save. Board still verifies and uses its exact returned artifact and immutable revision. No changes to authorization, source bytes, or normal save versioning.

Regression exercises two Mermaid fences in one message, where only the first has a Board transport artifact. Both reload readback calls retain their own original text. A second regression ensures a newer transport artifact does not mask an ordinary saved edit.

Verification (2026-11-09):
- `cd apps/web && pnpm exec vitest run tests/ui/chat-diagram-saved-readback.test.tsx tests/whiteboard/chat-board-source.test.ts`: 15 passed.
- Counterexample: temporarily remove the transport-title candidate filter and run the two-fence reload test. It fails with second diagram replaced by first; restored the filter afterward.
- These are transport/readback unit and component regressions, not production browser evidence.
