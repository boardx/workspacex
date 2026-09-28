# Board real-model acceptance

Only the main session executes this paid-model lane. The config reuses the existing
real-model config and credential source, never the fullstack loopback provider.
After starting `e2e-up.sh` inside `with-test-isolation.ts`, run **in the same isolated
environment** (do not derive a second set of database and port names):

```sh
BOARD_REAL_MODEL_PREPARE_FIXTURE=1 REAL_MODEL_E2E_USE_FULLSTACK_SEED=1 \
REAL_MODEL_E2E_START_WEB=1 \
pnpm --filter web exec playwright test --config playwright.board-real-model.config.ts
```

Global setup invokes `apps/api/scripts/prepare-board-real-model.ts` through the
existing `asOwner` fixture connection. It requires explicit local fixture opt-in,
`WORKSPACEX_ISOLATION_ID`, matching `WORKSPACEX_DB`/`PGDATABASE` with a `wsx_` test
name, loopback PG/web, isolated ports and no deployment profile. Remote targets
are rejected before connecting. Existing `.env.local` loading stays in the standard
real-model stack script; this helper does not read or print credentials.

The helper reads the seed account and published seed Agent's real model, publishes
a dedicated semantic clustering Skill through `wave2_publish_skill_version`,
publishes a separate Agent pinned to that immutable Skill, and registers only
`board:read`/`board:write` for the seeded delegator. It never modifies the original
Agent or grants runtime registry write permission. Model and actor are handed to
the spec automatically; an explicit `BOARD_REAL_MODEL_EXPECTED_MODEL` must match.

The test creates 30 actual notes via UI, invokes the real AI Organize endpoint and
model router, previews without writes, confirms one transaction, grants a distinct
seeded member editor access, proves that member's independent browser observes the
result, and invokes one server Undo that the member also observes. It archives only
its board with lifecycle CAS. Fixture entities leave with normal isolated database
teardown.

Evidence contains scrubbed inputs, proposal/runtime pin, actual revisions and model
elapsed time, JSON SHA-256, preview and peer screenshots. Trace/video are disabled
to avoid recording login credentials. Structural assertions award no subjective
score; main-session human visual/semantic review remains required. Missing
credentials visibly skip; invalid published model/actor fails. `--list` only
collects; it does not prepare PG or call a model.
