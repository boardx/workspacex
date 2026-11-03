# Unified release live evidence — 2026-11-03

Installed server tools: `7a14c4e30b7fddcaf61dfef41bdbf77975626516`.
All hosts use `/usr/local/bin/workspacex-image-release <environment> <tag>` and `/srv/workspacex/{config,log,current,previous,backup,data}`. Adoption preserved existing data mounts and application database destinations.

| Exercise | Run | Outcome |
| --- | --- | --- |
| Reuse existing develop tag on CN | https://github.com/boardx/workspacex/actions/runs/41596897791 | success; 41502993193-1; build skipped |
| New branch build for explicit CN target, empty tag | https://github.com/boardx/workspacex/actions/runs/41598796801 | success; produced all 5 image roles; 41598796801-1 |
| Deploy that new tag to CN | https://github.com/boardx/workspacex/actions/runs/41600811745 | success; database COMPLETE; runtime-readiness |
| Devapp incremental deployment | https://github.com/boardx/workspacex/actions/runs/41598983175 | success; 41578623880-1; database COMPLETE |
| US incremental deployment | https://github.com/boardx/workspacex/actions/runs/41600479414 | success; 41578623880-1; database COMPLETE |

CN result: `/srv/workspacex/log/release-0b7bf27a7e0d4436809e3f53df5a2327/result.json`.
Devapp result: `/srv/workspacex/log/release-5c6a1ea285de414290269c74ac1aa690/result.json`.
US result: `/srv/workspacex/log/release-082f0751ec1d4dc682c4a143928766d3/result.json`.
US fresh host query confirmed current=41578623880-1, previous=41248889927-1; api/web/agent/sandbox/sandbox-sessions/postgres/redis running. Migration receipt: 13 newly applied, 438 skipped, pending=[]; pre-migration dump=2,859,975 bytes.

US initial dispatch from worker branch was rejected by existing GitHub `production-us` branch policy before any job steps. Retried from allowed `develop` without widening permissions. The selected publishing branch must satisfy GitHub environment policy; image build source/tag can be reused independently.

Historical SQL handling matches the application migrator: committed names are skipped, original checksums retained, edits/removals reported as historicalDrift. Corrections require new filenames. No force replay or SQL down migrations.

Validation: 18 Python tests, 7 Node fault tests, real disposable PostgreSQL per-file transactions/retry/lost COMMIT acknowledgement, targeted planner/workflow contracts, and pre-push affected typecheck/lint passed. Independent reviewer accepted server tools and migration compatibility delta. Host validation intentionally checks runtime images/readiness; no business browser regression was claimed.

PR #6188 remains stacked on manual-only PR #6185 until the latter merges. Server entry installation is live independently. Do not claim automatic publishing disabled before #6185 is merged into the publishing branch. Old live mount directories were not deleted or moved; no blanket image/volume prune was run.
