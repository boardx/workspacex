# Maintenance activation consumer contract

This module implements source only. No host command, browser, service or database was run during its development.

`maintenanceOfflinePreparedAction(receipt, manifestBytes, verifyOfflineArtifacts)` and `maintenanceActivationAction(receipt, actions)` accept a **maintenance-specific** envelope `{prepared,maintenance}`. Prepared fields retain their original risk=`destructive`; the ordinary fast-lane schema still rejects destructive migrations. Maintenance binds the exact app/baseline/plan/attempt, tool SHA, recovery/object/writer/completion hashes, an explicit one-hour authorization, immutable manifest and images. This is an input contract, not proof that recovery has occurred.

`fixedMaintenanceActivationActions(binding)` calls fixed installed `/usr/local/lib/workspacex-cn/cn-maintenance-activation.py` with `--maintenance-activation-operation <fixed activation-plan.json> <sha256> <named action>`. All responses bind identity/tool/plan/action and writesHeld=true. It never invokes ordinary deploy or acquires another flock. Recovery invokes the real three-database executor first; only its exact durable result receipt can authorize runtime recovery and pointer restoration.

## Fixed host input locations

* `/etc/workspacex-cn/maintenance-activation/<app>/<attempt>/activation-plan.json`
* same directory `probe.env`, `browser-plan.json`, and the pinned ASR WAV fixture
* `/etc/workspacex-cn/candidate-configs/<app>/<attempt>/{deployment,baseline}.json`
* `/var/lib/workspacex-cn/runtime/<app>/{compose.json,nginx.conf,baseline.json,baseline-nginx.conf}`
* `/var/lib/workspacex-cn/runtime/<baseline>/compose.json`
* `/etc/workspacex-cn/maintenance-recovery/<app>/<attempt>/{recovery-plan,production-recovery-result}.json`

All plan/artifact paths require root:root 0600, no symlink/hardlink and root-private ancestors. The exact tool closure must include activation Python and drain/canonical/browser CJS modules. Host binaries docker/nginx/systemctl/node have pinned path and hash. Playwright and Chromium require a separate exact dependency/binary closure in the root-private profile (`maintenanceBrowserRuntime`); ordinary checkout node_modules links are not accepted. Runtime compose includes only fixed api/web/agent/sandbox/sandbox-sessions services, immutable prewarmed images, --no-build and --pull never.

## Live probes implemented

Drain uses actual 9b `agent_runs` lifecycle SQL in a READ ONLY transaction over verify-full TLS. Paused and awaiting_tool_permission block drain, as well as queued/running/writeback_pending. Unknown status and unsafe counts reject.

Canonical uses read-only source/image/config checks, actual data-readiness checks (database safety, migration ledger, Redis), cloud-service-readiness (web/API/registered graphs), and public GET deployment marker/API/login document. These are eight maintenance readback proof classes, **not re-execution of eight provision actions**. It never runs migrate, provision-admin or cloud-business-probe.

Browser uses existing 9b real UI selectors and authenticated product routes: login; hello with completed SSE/persisted succeeded run; microphone and actual expected ASR transcript from a pinned WAV; live `/api/feedback/<id>/github-issue` read bound to an existing issue; skill version in persisted run + configured sentinel + real tool trace; PDF authenticated download with `%PDF-` byte magic. It does not mock routes/models or accept supplied pass flags. It needs a designated account, owned thread/agent/skill fixture, real ASR fixture, existing feedback issue and bounded PDF prompt. It creates controlled product runs and records their terminal state; it does not erase production records.

## Hard ordering conflict

Current maintenance holds all writers and sets ordinary roles NOLOGIN. Six browser journeys require app writes. No approved, implemented controlled acceptance writer lane currently exists. `assertMaintenanceActivationCapability()` rejects **before pointer promotion** with `MAINTENANCE_ACCEPTANCE_WRITER_LANE_NOT_IMPLEMENTED`; host mutation/browser actions retain this rejection. Neither a profile boolean nor a successful fixture can clear it.

Human decision is required for a new bounded acceptance lane: private ingress, a single candidate API, least-privilege tenant-limited role/account, bounded lifetime and recorded run IDs, with all other writers held and inherited FD9/hold retained. Its role/permission operations and controller/fence state contract need explicit approval and implementation. An alternative is isolated candidate acceptance first and a separately approved production acceptance sequence; isolated success alone does not prove production login/core flows. Do not resume ordinary writers early or call a read-only health check browser acceptance.
