# Local backup fixture isolation implementation plan

> For agentic workers: execute this narrow maintenance plan inline using systematic debugging, test-driven development and verification before completion.

**Goal:** the existing real A-to-B backup/restore gate works while unrelated services own its historical fixed ports; cleanup touches only fixture-owned clients/listeners.

**Architecture:** PGliteSocketServer already binds port0 atomically and publishes its actual address. Return that port from the wrapper, retain occupied-port refusal for explicit ports, and use a small roundtrip-only fixture boundary with independent client and server finally blocks. No probe-close-port allocator, retry, timeout increase, global listener kill or #6195 fetcher change.

**Tech stack:** Node net, PGlite, pglite-socket0.2.11, pg, Vitest; same single-worker package config.

**Spec:** issue6196 and the coordinator's exact candidate/run/job failure; scope and acceptance below.

## Constraints and review focus

- Preserve actual dump >1000bytes,37chat_threads,1organization, new destination directory and real restore SQL.
- Explicit configured production ports retain fail-fast ownership checks.
- port0 must report a reachable nonzero endpoint, not a reserve/release candidate port.
- Client connect, client end and callback errors must release the owned listener.
- Cleanup must leave an independently owned sentinel listening and reachable.
- CI occupant identity is unknown; a controlled owned sentinel reproduces the failure class without attributing the CI owner.

## Tasks

- [x] Inspect failed candidate787e833b/run41650727829/job125968103154 and current developdfdaa470.
- [x] Run original roundtrip with free ports; then hold55492 with an owned sentinel and reproduce original failure.
- [x] Add reachable-port regression; observe handle.port0 failure before wrapper correction.
- [x] Extract fixture lifecycle and observe connect/end cleanup2reds before nested-finally correction.
- [x] Correct actual bound port and use port0 for all roundtrip operations; retain all data assertions.
- [x] Rerun controlled occupied-port test; original real roundtrip passes and sentinel remains alive.
- [x] Full package/typecheck/init and independent exact-source review.
- [ ] Clean normal push and PR todevelop.
- [ ] Follow new source CI and actual candidate; only main coordinator manages merge queue.
