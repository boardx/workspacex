# Real API startup fixture (T20 partial coverage)

`tests/cn_release_api_startup_linux.py` is a Linux-only integration entry. Setup
must install full repository dependencies and build the existing
`apps/api/docker/postgres-age` image on the GitHub runner. Pass its actual local
immutable image ID in `CN_API_STARTUP_PG_IMAGE=sha256:<64 hex>`; optionally pass an
absolute Node 22 executable in `CN_API_STARTUP_NODE`. The test never pulls an
image, installs dependencies, reads a production env file, or uses cloud keys.

The outer Linux runner must generate a fresh 32-hex `CN_API_STARTUP_OWNER_TOKEN`
before spawning this suite plus a root-owned 0700 `CN_API_STARTUP_OWNER_DIR`.
The fixture writes EXCL/fsynced `api-create-intent.json` before Docker create and
`api-create-receipt.json` only after exact container identity readback. A create
intent without receipt remains unknown even if a label query is currently empty.
The outer runner must, on every exit including timeout/SIGKILL, remove
only Docker containers bearing `cn-startup-fixture=<that token>` and verify
absence against a responding daemon. The fixture requires this token; internal
`finally` alone cannot cover SIGKILL. The outer suite budget remains 1200 seconds; report actual duration including
preparation, without treating this bound as measured performance.

Run from a clean, isolated Linux checkout under the simulation cgroup:

```sh
python3 -I -B tests/cn_release_api_startup_linux.py
```

Every invocation creates one unique labelled PostgreSQL container with an
exclusive loopback host port; one fresh baseline receives all original migrations once per round, then
connections to it are disabled. Three independently cloned databases validate
every original migration checksum and an unchanged baseline canary before
mutating their own canary. No mutated scenario database is reused. Only its labelled container ID may be removed. A lost
Docker run response is reconciled by the preselected unique name, never rerun.
Cleanup must be confirmed or the aggregate fails. Node children have bounded
output/time; outer simulation cgroup supervision remains required for escaped
sessions. PostgreSQL Docker tasks require the explicit container cleanup too.
Setup/build time must be reported separately and included in total lead time.
An immutable image/dependency cache may be reused; mutated databases may not.

The TypeScript fixture calls actual `startApi`, not `createApp`, with local env
loading disabled. It neither replaces startup cleanup/recovery/seed functions
nor authorizes production operations. Real database checks cover:

- full migrations and separate non-owner runtime/diagnostics roles;
- old versus fresh error/debug log retention;
- previously absent official platform skills seeded by actual startup;
- a stale running task's real recovery attempt/lease update, with a fresh task
  preserved and no remote operation replay;
- unrelated rows preserved;
- real SQL permission denial of DELETE, and a real trigger denying platform
  organization seeding: listener availability must not count as side effects
  accepted in either counterexample.

The scenario receipt's `verified:true` means its assertions passed. For failure
counterexamples, `startupSideEffectsAccepted:false` remains mandatory. The final
receipt never grants release-driver/business acceptance. This suite has not yet
executed against Linux in this authoring session. Missing dependencies or an
unsupported host return nonzero; they are not skip/pass results.

Remaining T20 coverage: queued model/tool worker execution, 500000-row debug
limit, repeated process restart/idempotence, and actual release-driver hold /
rollback composition. No real model, ASR, RDS, or production data is exercised.
The source hash in the aggregate describes the tested checkout; it is not a
claim that another candidate or deployed source was tested.
