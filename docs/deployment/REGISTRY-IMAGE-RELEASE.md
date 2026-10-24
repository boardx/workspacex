# GitHub Runner → ACR → DevApp / CN

The `image-release` workflow builds the five existing release Dockerfiles on
GitHub-hosted Ubuntu. It has no dependency on PR or backend-gates jobs. Tags are
`<full-source-SHA>-<GitHub-run-id>-<attempt>` and never overwritten. Rerun **all**
jobs for a new attempt; rerunning only failed build jobs is rejected.

After all five images have been pushed and read back, a complete `release.json`
artifact is retained. The selected host pulls the exact tag for all five images,
checks revision labels/platform/registry digests, and updates only the five
application services (API, Web, Agent, Sandbox, sandbox sessions). PostgreSQL and
Redis containers and volumes are not replaced. PostgreSQL is built for parity
with the existing producer, but updating data services is a separate operation.

## GitHub configuration

Repository Actions secrets:
- `WSX_ACR_USERNAME`: ACR registry username, not an AccessKey ID.
- `WSX_ACR_PASSWORD`: ACR fixed registry password, not the console password or a manually generated one-hour token.

Repository Actions variables:
- `WSX_ACR_REGISTRY`: authenticated **public** registry hostname, no scheme.
- `WSX_REGISTRY_PREFIX`: that hostname plus the existing namespace.
- Optional `WSX_NODE_IMAGE`, `WSX_PYTHON_IMAGE`, `WSX_POSTGRES_IMAGE`: overrides including `@sha256:...`. Without overrides, the hosted plan resolves the existing Dockerfile defaults once to immutable digests and passes the same pins to every build. The postgres value supplies `PGVECTOR_IMAGE`.
- `WSX_IMAGE_RELEASE_ENABLED`: leave absent during setup; set to `true` only after both host consumers and their rollback have actually been verified.

Builders use the existing `production-cn-build` environment. Set the build
variables at repository scope so the manifest aggregation job sees the same
prefix. DevApp uses the `devapp` environment and existing `workspacex` runner;
CN uses `production-cn` and `workspacex-cn-production`. Existing environment
protections are respected, not removed by this workflow.

The public endpoint must actually be enabled and reachable from GitHub-hosted
runners. The existing `-vpc` endpoint is for VPC consumers and cannot be used by
hosted builders. A consumer may use its VPC alias to the **same** ACR instance and
namespace; it resolves and checks the complete tag itself. Do not create public
repositories or change RAM policies just to make login pass.

## Host preparation (one time)

1. Prepare the environment's full application Compose runtime using the existing
   cloud-deploy tooling, preserving its real env files, networks, security
   profiles, mount paths and data. **DevApp currently runs API/Web through
   systemd, so the root dependency-only `compose.yaml` is insufficient.** Its
   application Compose migration and baseline acceptance must finish before
   enabling this lane. The consumer rejects missing baseline application
   containers; it does not stop systemd or improvise mounts/secrets.
2. Install the reviewed scripts using `sudo bash scripts/install-image-release.sh
   <runner-user>`. This installs a content-addressed root-owned closure and one
   fixed sudo entry; it does not deploy. Account permission changes require the
   operator's normal approval.
3. Give the host a root-private Docker credential directory with an existing
   **pull-only** ACR login. Do not copy GitHub's write credential to runtime hosts.
4. Create `/etc/workspacex-image-release/{devapp,cn}.json`, root:root 0600. See
   `deploy/examples/registry-image-release.json`; replace every example value with
   observed live configuration and hashes. Pin the full business/browser probe's
   script and config files in `verificationFiles`.
5. Prepare a root:root 0700 state directory. Reuse the canonical existing lock:
   DevApp `/run/workspacex-devapp-deploy.lock`, CN
   `/var/lib/workspacex-cn/runtime/release.lock` (root:root 0600, single link).

The fixed helper clears the caller environment. The deployment runs in a
systemd service so runner cancellation cannot kill recovery midway. Each
attempt gets a durable private intent, manifest, config, schema inventories,
old/new image overrides and terminal receipt. No raw Docker or provider output
is uploaded to GitHub.

## Verification and recovery

Before replacing containers, the baseline must pass image/config checks,
HTTP health, and the fixed business probe. API SQL bytes and Agent memory
schema/lock inventories must match the previous images. A schema change is
rejected before activation; migrate it separately with backward compatibility
and a real rehearsal, rather than pretending an image rollback undoes SQL.

Activation uses explicit application service names with
`--no-deps --no-build --pull never`. It verifies actual running image IDs,
Compose ownership, health and business/browser behavior. Only success updates
`current.json`. A partial Compose failure, readiness failure or TERM/INT restores
exact previous image IDs, then repeats runtime and business verification.
`ROLLED_BACK` still exits nonzero. `ROLLBACK_FAILED` keeps `pending.json` and
blocks later attempts. Host power loss, SIGKILL, lost Docker daemon or an
uncertain state write also need explicit reconciliation; automatic rollback
cannot prove recovery from an unavailable host.

Routine releases preserve environment configuration and do not run migrations.
Changing runtime config belongs to a separate prepared environment change.
The live Compose config hash must match the pinned baseline, otherwise release
stops before replacement.

## Usage and cutover

Manual workflow dispatch on `main`: choose `devapp` or `cn`; specify a complete
existing tag to deploy without rebuilding, or leave tag empty to build that
commit first. After actual acceptance, enable the shared cutover variable.
`develop` pushes then build and deploy DevApp; `main-cn` pushes build and deploy
CN. The old automatic deploy writers use the inverse flag so they cannot race
the new automatic lane. Existing privileged/manual operations still use the same
host locks.

## Current rollout boundary

Implementation tests are not production acceptance. ACR public access,
credentials, base image pins, the DevApp Compose conversion and installed host
policies must be observed on the actual environments before the switch is set.
