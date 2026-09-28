# Real Chat → Board three-diagram producer

Main-session execution only. This is an additive paid-model lane, not the deterministic
fullstack config and not an already completed acceptance result.

In the **same isolated environment** where the main session has already started the real-model
API/runtime with the established real-model credential loading, run:

```sh
BOARD_REAL_MODEL_PREPARE_FIXTURE=1 REAL_MODEL_E2E_USE_FULLSTACK_SEED=1 \
REAL_MODEL_E2E_START_WEB=1 \
pnpm --filter web exec playwright test --config e2e/support/chat-board-real-model.config.ts
```

Reuse the [Board real-model setup instructions](../board-real-model-README.md). This config
inherits `playwright.real-model-smoke.config.ts`, including credential parsing, API-prefix
routing and optional Web startup. It does not call `e2e-up.sh`, kill global pidfiles, load secret
files itself, seed assistant messages, intercept requests, or substitute model responses.
The main session must manage isolated service PID/log paths and shutdown. Do not run it beside
another lane sharing `.next-real-model-e2e` or its web port.

Global setup reuses the existing trusted isolated `prepare-board-real-model` fixture. It
checks the published real model and creates its separate actor/Skill, leaving the original
Chat Agent unchanged. The generated `BOARD_REAL_MODEL_ACTOR_ID` is used only as the authorized
Board read actor here. `FULLSTACK_E2E.agentId` alone is **not** a registered Board read identity.
Missing credentials, prepared actor or published model fail visibly; this lane has no skip or
external-URL fallback and no automatic retries.

For each family (flowchart, sequence, persona), the test starts a new `/chat` UI conversation,
sends a prompt with a new task nonce, and waits for a durable assistant message with a run ID.
It reads the actual run, requires success and matching input/result message IDs, and verifies
its provider/model equals the prepared real-model expectation. It then reloads and verifies
exact persisted text and a rendered Fabric canvas. It never supplies an expected assistant
answer; prompts specify format and subject, while the real model generates the contents.

Only after all three sources exist does it call `produceChatBoardThreeDiagramEvidence` to
save, insert, check canonical geometry, check tamper/idempotency boundaries, reload and export
source. Output includes each real run/message/version ID, prompt/assistant hashes, elapsed time,
render screenshots and the canonical roundtrip evidence. Trace/video are off to avoid recording
login tokens. Keep test artifacts private; even synthetic prompts may be reflected in responses.

The older external-source lane remains available but now requires `BOARD_CHAT_READ_ACTOR_ID`
in addition to its three `BOARD_CHAT_*_URL` values. Those URLs are not used by this new lane.

Static preparation completed with `playwright ... --list` (one test collected). No HTTP,
model call, Docker or browser execution was performed while developing this producer. The
main session must record real results and investigate model/diagram or runtime failures; a
collection pass does not establish source-generation or rendering success.
