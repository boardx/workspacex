# CI connector setup focus race (#6390)

The #6374 merge-group candidate47cfec41f4f3dcb19923196873b294a192909778 failed board-smoke run42350256127/job128338999703 before connector gesture: the editor remained visible after global Escape. Trace and the existing product component agree that visibility precedes intentional requestAnimationFrame focus.

Only the connector test setup now awaits actual toBeFocused before its original single Escape. Its hidden assertion and every connector/endpoint/canonical/update/ACK/peer/refresh/cancel/cleanup assertion remain unchanged. Product behavior, timeouts, gate policy and retry configuration are unchanged.

Deterministic existing counterexample executed on 2026-11-07: pnpm --filter web exec vitest run tests/ui/thinking-input-editor.test.tsx -t 'does not receive outline Escape' --maxWorkers 1 --minWorkers 1; exit0, 1passed/9unselected. Product/test blobs match the exact develop base. The existing test freezes RAF, proves a visible editor has not yet focus and global outline Escape does not cancel, then runs RAF and verifies one cancellation from the focused editor.

This unit proof is not full Fabric acceptance. The corrected isolated connector browser case and new head/merge candidate CI remain required; no browser-green claim is made here. Protected queue removal of #6374 is retained until this failure is resolved. Full private CI trace/log remain outside the repository; source failure run is publicly linked in #6390.
