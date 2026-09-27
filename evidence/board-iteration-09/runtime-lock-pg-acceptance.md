# Runtime pin: real PostgreSQL acceptance

Producer implemented; **not executed**. Main session exclusively runs this against its existing isolated local stack after migration `20260927180000_whiteboard_runtime_pin_lock.sql`. No Docker, PostgreSQL server, browser, or model is started by this script.

First prepare the dedicated Board fixture using `pnpm --filter @repo/api exec tsx scripts/prepare-board-real-model.ts`. It uses the existing fullstack seeded principal and published real model, and creates its own Agent/Skill; do not substitute a production actor. Retain its returned actorId in `BOARD_REAL_MODEL_ACTOR_ID` without logging any credentials.

Within the **same existing isolation shell**:

```bash
export BOARD_RUNTIME_LOCK_PG_ACCEPTANCE=1
export BOARD_RUNTIME_LOCK_EVIDENCE=/private/tmp/board-runtime-lock-unique-run.json
pnpm --filter @repo/api exec tsx scripts/verify-board-runtime-lock-pg.ts
```

Use a fresh output path. The script requires the same guarded local fixture environment: `BOARD_REAL_MODEL_PREPARE_FIXTURE=1`, `REAL_MODEL_E2E_USE_FULLSTACK_SEED=1`, `WORKSPACEX_ISOLATION_ID`, `WORKSPACEX_DB`, `PGDATABASE` matching the isolated `wsx_…` identity, local `PGHOST`, `PGPORT`, `WORKSPACEX_WEB_PORT`, and no `WORKSPACEX_DEPLOY_PROFILE`. Existing official DB helpers consume `APP_DB_USER` / `APP_DB_PASSWORD` and `MIGRATION_DB_USER` / `MIGRATION_DB_PASSWORD`; the app connection must really be `app_rw`.

The script checks tenant/delegator rejection and app_rw registry UPDATE denial. Two separate probes hold the actual SQL function lock as app_rw while the owner fixture connection (a) changes the published Agent version and (b) disables the registry. Actual `pg_blocking_pids` must name the app connection before commit; the writer must complete after commit. All writer changes are rolled back. Original pointer, registry fields, version count, and operation count must be identical at the end. The evidence contains no credentials. This is SQL lock/permission acceptance, not a replacement for the full proposal-confirm API/browser journey or a model-quality score.

## Real-model browser startup

`playwright.board-real-model.config.ts` inherits `playwright.real-model-smoke.config.ts`. It does not start the API/database. Main session must use a real-provider API, not the fullstack loopback model server.

- Local seed login: `REAL_MODEL_E2E_USE_FULLSTACK_SEED=1`; alternatively `REAL_MODEL_E2E_EMAIL` and `REAL_MODEL_E2E_PASSWORD` for explicitly configured real login.
- `REAL_MODEL_E2E_BASE_URL`, `WORKSPACEX_WEB_PORT`, `WORKSPACEX_API_PORT`; `REAL_MODEL_E2E_START_WEB=1` builds/starts local Next and configures `/__fullstack_api`. Without it the config assumes an existing deployment with same-origin API paths.
- `BOARD_REAL_MODEL_PREPARE_FIXTURE=1` invokes the isolated trusted fixture global setup and sets `BOARD_REAL_MODEL_ACTOR_ID` and `BOARD_REAL_MODEL_EXPECTED_MODEL`. Explicit expected model must match the published real model.
- API provider environment is loaded through the repository's `scripts/real-model-env.sh`: `WORKSPACEX_ENV_FILE` points at the existing trusted env file; `real_model_load_env_file "$PWD"` exports internally. The existing DashScope startup uses `DASHSCOPE_API_KEY`, `DASHSCOPE_BASE_URL`, `DASHSCOPE_MODEL`, deriving runtime `KERNEL_MODEL_*` variables. The helper also supports existing DashScope deployment aliases. Never use `set -x`, `env`, `printenv`, or echo secret values. Do not load a production deployment profile into the isolated fixture process.

After the real API is already ready in the same isolation shell:

```bash
pnpm --filter web exec playwright test --config playwright.board-real-model.config.ts
```

Keep the existing fixture global setup and actual provider/model checks enabled. A collected test, skipped login, or preconstructed proposal is not real-model evidence. Human semantic/visual quality remains separately reviewed.
