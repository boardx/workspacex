# Native Local AIDT profile: configuration and PGlite evidence

The selected local path reuses `packages/local-runtime` rather than the expiring Docker/fullstack test stack. No production, server permissions, model keys or service contracts changed.

## Explicit profile

`resolveLocalConfig({repoRoot, dataDir, profile: "aidt"})` enables the four approved A+B switches. Omitting `profile` chooses `"default"`; unknown profile values fail validation.

| Child process | default | aidt |
| --- | --- | --- |
| API and owner seeds: `ENABLE_AIDT_MODULE` | 0 | 1 |
| API: `ENABLE_PROJECT_MEMBER_CHAT` | 0 | 1 |
| Web: `NEXT_PUBLIC_ENABLE_AIDT` | 0 | 1 |
| Web: `NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT` | 0 | 1 |

Explicit zeroes prevent host `ENABLE_*` variables from silently enabling teaching features in ordinary Local. This does not delete previously installed Skills or saved data. `runOwnerSeeds` already uses `apiEnv(c)` and idempotently backfills standard packs every owner phase, so the profile reaches AIDT Skill installation without a second installer.

The worker changed only `src/config.ts` and added its own tests. `up.ts` and the original CLI were not changed. Root-owned start/stop/health tooling must pass `profile:"aidt"`; simply invoking the old CLI without this profile remains ordinary Local. The selected controller uses development Web mode. Existing production Web validation checks only the baked API URL, not feature switches, so an arbitrary old build cannot be accepted as an AIDT build by address alone.

## Persistence and login path

The existing `up` path opens the same data directory as owner, runs the normal migration CLI and owner seeds, closes it, and reopens it as `app_rw`. The object store and session store are native files under the same data directory. Secrets are generated once in `secrets.json` and read again on restart; switching profiles does not rotate them or change database/session/object paths.

The existing provision-admin script creates the real Local account (`me@local.workspacex`) using the generated password and original auth repositories; this is not the disposable fullstack test account. Configuration tests verify stable secrets, but they do not by themselves prove HTTP/browser login. The root/QA acceptance owns that separate native start→login→save→stop→restart check.

## Actual checks

1. `pnpm --filter @repo/local-runtime exec vitest run test/migrations-apply-on-pglite.test.ts`: **3/3 passed**, about 31 seconds. Runs the production `runMigrations` path from an empty PGlite database and asserts every migration file was applied. This passed before configuration was changed.
2. `pnpm --filter @repo/local-runtime exec vitest run test/aidt-pglite.test.ts`: **1/1 passed**, about 32 seconds. Uses actual PGlite and PostgreSQL wire clients, not a database mock or Docker service. Verified all three A+B tables have FORCE RLS; the serving role is `app_rw`; A/B inserts persist; cross-org reads hide rows and writes fail; immutable-stage UPDATE and message DELETE fail; a duplicate message receipt hits its real unique constraint; same-directory server reopen preserves content and counter; archived data remains readable while new stage/counter writes fail. All test rows are synthetic and confined to its own temporary directory; it closes its clients/listeners and removes that directory.
3. Configuration and original-mode regression: **27/27 passed in 6 files**, including explicit profile flags, host-environment isolation, stable credentials/paths, Local parity, deployment edition and billing isolation.
4. `pnpm --filter @repo/local-runtime typecheck`: **exit 0**.

Logs: `pglite-migrations.txt`, `pglite-ab-persistence.txt`, `config-tests.txt`, `typecheck.txt` in this directory. These checks do not establish API-level member authorization, two-browser delivery, actual model quality or a user's installed machine; those require their own real native acceptance.

## Real capability boundaries

No loopback fixture supplier is introduced. Native Ollama, Python tool runtime and ASR remain their original optional dependencies. Missing model/binary/assets must stay deferred/unavailable; the profile does not manufacture a successful answer or configure cloud endpoints. A+B structured drafts and text persistence do not require model inference to store data. C participant-consented interview recording and voice rooms remain outside this delivery.

PGlite's existing serving model is accepted only for single-machine loopback: it opens as `app_rw`, but its socket frontend does not provide normal PostgreSQL multi-user authentication and `session_user` retains the owner identity. This profile does not widen network binding or advertise a classroom/LAN server. Existing memory/disk doctor results remain facts, not checks to bypass for a demonstration.
