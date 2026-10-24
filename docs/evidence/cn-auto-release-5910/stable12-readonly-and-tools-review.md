# Read-only stable12 diagnostic and independent tools review

No ECS command was executed by this worker. These are reviewable operations for
the parent operator, not evidence that the production checks have passed.

## Stable12 diagnostic

The script is `.harness/scripts/vm/cn-stable12-readonly.ts`. It imports the
canonical key list and consumer drift validator, then statically follows the
actual API/Agent/Bootstrap object spreads. It never calls `runtimeEnvironment`,
`ensureDeploymentSecret`, or a producer that writes credentials.

The protected installed Compose baseline helper supplies the current complete
Compose capture and its canonical stable path. The script derives only that
capture's `baselineRuntime/secrets` and `baselineRuntime/bootstrap.env`; it does
not scan other secret directories. All file values remain in memory. It checks
root ownership, private directory/file modes, no symlinks, single file links,
unchanged metadata, and unchanged baseline capture. Output includes only fixed
key IDs, comparison/status booleans, counts, and fixed diagnostic identifiers.
It emits no values, value hashes, paths, file identities, or raw command errors.

Run from the exact reviewed root-owned tool checkout, with its already installed
Linux dependencies, under the canonical release lock. Replace `TOOL_ROOT` with
the installed exact path; do not use the runner-owned `/opt` parent tree.

```bash
set -euo pipefail
TOOL_ROOT=/var/lib/workspacex-cn/auto-preparation-tools/EXACT_REVIEWED_TOOL_SHA
exec 9</var/lib/workspacex-cn/runtime/release.lock
flock -n 9
cd "$TOOL_ROOT"
TSX_DISABLE_CACHE=1 node --import tsx .harness/scripts/vm/cn-stable12-readonly.ts
```

Expected boundary: a production bootstrap environment exposes only generated
`admin-password`. Live API/Agent environments expose the other four generated
identities: model cipher, email verification, native binding, and service key.
Production database/cache credentials come from external secretRefs; comparing
those to Starter-generated keys would assert the wrong identity.

If protected legacy files contain all twelve equal values, and all actual live
consumers also match, `all12Proven=true` and exit0. If the legacy directory is
absent, at most five identities can be `live-same`; the seven unconsumed keys
remain `unknown`, `all12Proven=false`, and exit3. A missing bootstrap file or an
unsafe key is reported as unproven rather than fabricated equality. A live
consumer mismatch fails even if all legacy files match. This diagnostic neither
creates a missing `stable-secret-directory.ref` nor changes admission policy.

## Tools image review after the parent's one-time build

The reviewed Dockerfile is `deploy/aliyun/images/cn-shadow-tools.Dockerfile`. It
uses the supplied immutable cached Node base and Debian's normal signed apt
repositories to install Chromium/nginx. It contains no project/data/secret copy.
The image's default entrypoint is nginx; browser commands must explicitly
override it to `node`.

1. Resolve the built tag to its actual image ID. Verify Linux/amd64, no unexpected
   env keys or volumes, and nginx default entrypoint. Compare its RootFS layer
   prefix with the exact cached Node base image selected for this build. Review
   the safe history commands against the exact input Dockerfile and build args;
   a matching tag alone is insufficient provenance.
2. Execute version checks with `--pull=never --network=none --read-only`, fixed
   CPU/memory/pids bounds, no host mounts, and `/tmp` tmpfs. This checks actual
   executables independently of build-time RUN output.
3. After the exact root tool checkout's Linux dependency closure exists, run the
   existing canonical browser runtime preflight against that actual Chromium,
   with the checkout mounted read-only at the same absolute path. No production
   configuration, env file, Docker socket, public port, or credential is mounted.

Concrete verification commands (the operator supplies exact immutable IDs and
the reviewed tool path; this worker did not execute them):

```bash
set -euo pipefail
IMAGE_ID=$(docker image inspect --format '{{.Id}}' workspacex-cn-shadow-tools:ad4e9ed831439a5f)
[[ "$IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
timeout 60s docker run --rm --pull=never --network=none --read-only \
  --memory=512m --cpus=.3 --pids-limit=512 --cap-drop=ALL \
  --security-opt=no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --entrypoint /bin/sh "$IMAGE_ID" -ec \
  'node --version; /usr/bin/chromium --version; /usr/sbin/nginx -v'

TOOL_ROOT=/var/lib/workspacex-cn/auto-preparation-tools/EXACT_REVIEWED_TOOL_SHA
timeout 120s docker run --rm --pull=never --network=none --read-only \
  --memory=512m --cpus=.3 --pids-limit=512 --shm-size=256m --cap-drop=ALL \
  --security-opt=no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --mount "type=bind,src=$TOOL_ROOT,dst=$TOOL_ROOT,readonly" \
  -e HOME=/tmp -e CN_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
  --entrypoint node "$IMAGE_ID" \
  "$TOOL_ROOT/.harness/scripts/vm/cn-release-browser-smoke.mjs" --preflight
```

The second command must emit the canonical
`CN_BROWSER_RUNTIME_PREFLIGHT_PASSED` marker and exit0. Missing Playwright/Linux
dependencies is a genuine remaining setup blocker, not permission to replace
the probe with a literal success. These tool checks do not establish candidate
login/notifications, production TLS, shadow readiness, or production deployment.
After success, use the same inspected immutable image ID for both policy fields
`nginxImage` and `browserImage`; retain explicit entrypoint override for browser.

Local script tests cover canonical five-key derivation, consumer mapping drift,
missing/different values, honest unconsumed-key status, and redacted output.
They do not read host secrets or establish live stable12 continuity.
