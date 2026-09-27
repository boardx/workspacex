# Board CI execution and evidence boundary

`.github/workflows/board-acceptance.yml` runs on every PR, push to main, and manual dispatch. No path filters, conditional lane gates, exemptions or continue-on-error are used. The existing spec-gate can follow each literal `pnpm --filter web run ci:board:*` script to its actual Playwright config. It does not infer reachability from a dynamic lane name.

Seven independent jobs execute journeys, security, visual/accessibility (Chromium/Firefox/WebKit), storage/import, all three performance scales, fifty-client collaboration and meeting-room endurance. Each owns the standard isolated stack through `with-test-isolation`; that wrapper performs teardown on normal failure/signals. Workflow cancellation does not intentionally interrupt another revision's producer. Job time budgets include build/cleanup headroom; the long tests retain their original 45-minute limit, >=30-minute observation interval, zero retries, fifty independent contexts and twenty concurrent writers. A resource-constrained runner fails; the load is never reduced to fit it.

The lane runner requires a clean exact revision and isolated environment, invokes the supplied real Playwright command, rejects zero/missing/skipped/retried/expected-failure tests, then reuses the existing evidence policies. The per-run marker and start time bind runtime and report to this invocation. It does not use the global acceptance runner, whose deliberate incomplete/fail-closed aggregate result is unchanged. A lane may pass engineering observations while keeping `approved:false`, `score:null` and explicit pending human/hardware/real-account checks.

Signed lanes generate a cryptographically random, per-job HMAC key in memory, register it with GitHub masking, and inject it only into the child producer environment and same-process verifier. Neither the key nor environment dumps are evidence artifacts. This proves internal artifact integrity, not an independently signed audit or human approval. Reports and screenshots are retained for fourteen days; browser traces are off for these lanes. No production/model secrets or permission relaxations are introduced.

## Superseded stub mapping

| Removed short spec | Actual replacement |
| --- | --- |
| `board-accessibility-input.spec.ts` | `board-visual-accessibility-acceptance.spec.ts`: three browsers, viewport/state captures, keyboard, touch/pen, axe counterproofs and report validator |
| `board-collaboration-load.spec.ts` | `board-collaboration-soak.spec.ts`: independent identities, 20 writers, 50 contexts, real reconnect and ACK/convergence ledger; security lane covers actual revocation |
| `board-security.spec.ts` | `board-security-acceptance.spec.ts`: actual API, WebSocket, tenant/role, revoked and image-object negative cases |
| `board-import-storage.spec.ts` | `board-durable-images.spec.ts` plus `board-vendor-schema-migration.spec.ts`: actual PG/FS image durability, independent peer, revoke, deletion and three canonical/portable media roundtrips |

The obsolete `board-three-browsers.config.ts` is removed; the visual lane owns the three-browser matrix and journey has its own evidence-producing config. These replacements do not claim all storage lifecycle or real vendor account acceptance: those remain pending and separate from these CI checks. Existing stronger R7/R8/R9 tests remain untouched.
