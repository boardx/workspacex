# WX-E003 isolation and service evidence

2026-09-07. The initial feasibility experiment below is retained as history. The final implementation and dedicated opt-in deployment configuration are verified in the final section. Existing production deployment was not changed.

## Reproducible upstream baseline

- Moby profiles commit: `61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31`.
- Source: https://raw.githubusercontent.com/moby/profiles/61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31/seccomp/default.json
- SHA256: `536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74`.
- This is the official profiles repository baseline; it has NOT been proven identical to the embedded Docker 29.6.1 profile.
- Docker 29.6.1, LinuxKit kernel 6.12.76. Container reported CapEff=0, NoNewPrivs=1, Seccomp=2; host user.max_user_namespaces=31735. Docker security options listed builtin seccomp and cgroupns, no AppArmor.

The experimental outer profile appends ALLOW for unshare, mount, umount2, pivot_root, chroot, setns and clone. This is a broad candidate delta that needs reduction before deployment. It is only permissible in this experiment because bubblewrap installs an additional filter before executing user code.

## Failure evidence and equivalent-policy experiment

1. Default Docker profile with cap-drop ALL: bubblewrap user namespace creation fails with EPERM.
2. Candidate profile: namespace creation succeeds, but mounting /proc fails with EPERM.
3. Omitting /proc while retaining --disable-userns fails because bubblewrap cannot write /proc/sys/user/max_user_namespaces.
4. Authorized local experiment: omit /proc and --disable-userns, retaining --unshare-all, explicit --unshare-user, empty environment and mount allowlist. Install BPF with the official bubblewrap --seccomp FD mechanism, generated through libseccomp, before untrusted code starts.

The second filter denies unshare/setns/mount/umount2/pivot_root/chroot with EPERM, denies each clone namespace bit with EPERM, and returns ENOSYS for clone3 so libc can fall back to ordinary clone for threads. Ordinary clone remains available. The Python probe actually invokes forbidden syscalls; this evidence does not rely only on reading policy text.

## Execution

Image `workspacex-skill-sandbox:e003` was built from the existing sandbox Dockerfile with Python/bubblewrap installed. It predates the final HTTP/schema wiring; this experiment verifies isolation feasibility, not the final service image.

```sh
docker run --rm --network none --read-only --user node --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=/private/tmp/wx-e003-seccomp-candidate.json \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m --memory 1g --pids-limit 128 \
  --mount type=bind,src=/private/tmp/wx-e003-probe.py,dst=/probe.py,readonly \
  --entrypoint /usr/bin/python3 workspacex-skill-sandbox:e003 /probe.py
```

Exit code 0; captured output:

```text
UNSHARE_SETNS_MOUNT_CLONE_FLAGS_EPERM_CLONE3_ENOSYS
PYTHON_FILE_READONLY_SOCKET_NETWORK_SECCOMP_OK
NODE_OK
  exit 0
```

Python and Node successfully write /workspace. /skills writes fail, /run/sandbox and /proc are absent, external socket connection fails. No docker.sock, host shell fallback, privileged container, unconfined policy or added capabilities was used. All experimental containers used --rm.

## Service verification

`pnpm --filter @repo/skill-sandbox typecheck` passed. Targeted Vitest run passed 21 tests across session paths, manager, HTTP and generated contract. Includes an 8 MiB canonical base64 boundary and concurrent create capacity reservation. These are unit tests and do not replace a final service image integration run.

At this initial experiment stage the final service image was not yet verified; the following final section supersedes that limitation. Production host rollout still requires its own probe.


## Final implementation verification

- Final image manifest list: `sha256:8a34ec8d221940aa20538eb830461d95259ccd9adddf2d9bbceb893b4f9c18e9`.
- Final image config: `sha256:963ad4eb440c577a04533eed9dc67bdf637660c0932c2ed19ac74054bcf4e222`.
- Dedicated `apps/skill-sandbox/docker-compose.sessions.yml` defines only `skill-sandbox-sessions`. It inherits the existing container restrictions and adds the reviewed profile; `compose-resolved.yml` records the actual merged configuration. Its independent socket volume mounts `/run/sessions`; the image initializes that directory for the non-root user. The sessions-only instance rejects `/run` with 404. The original compose/profile/socket and default `/run` behavior remain unchanged.
- Final policy `apps/skill-sandbox/security/docker-seccomp.json` removes the initial experiment's unnecessary setns/chroot exceptions. Only unshare, mount, umount2, pivot_root and clone are added to the fixed upstream baseline. Mandatory second-layer BPF also denies the newer mount API and CLONE_NEWTIME; it is compiled through libseccomp in the target image and passed with bubblewrap FD3. Unsupported ABIs fail image build.
- Typecheck passed; 25 targeted tests across 4 files passed, including identical Python/Node generated contract bytes, pending-probe cancellation, closing admission capacity, immutable skills and the 8 MiB base64 boundary.

Executed from `apps/skill-sandbox`:

```sh
docker compose -f docker-compose.sessions.yml -p wx-e003 run --rm \
  --volume /private/tmp/workspacex-standard-capabilities/apps/skill-sandbox/tests/session-container.mjs:/session-test.mjs:ro \
  --entrypoint node skill-sandbox-sessions /session-test.mjs
```

Exit 0:

```text
skill-sandbox listening on unix:/run/sessions/skill-sandbox.sock
HTTP_SESSION_PYTHON_NODE_DOWNLOAD_TIMEOUT_CANCEL_OK
```

The runner starts the actual `main.js` using the configured socket and sessions-only environment. It asserts HTTP creation/upload, actual Python and Node execution, exact downloaded contents, immutable skills, sibling-session capability and filesystem isolation, actual external socket connection denial, hidden control paths and credentials, missing/corrupt BPF rejection, unshare/setns/mount and every clone namespace flag returning EPERM, clone3 ENOSYS, 1 MB output truncation while execution still completes its artifact, hard timeout, cancel, and `/run` 404.

Separate default-profile regression:

```sh
docker run --rm --network none --read-only --user node --cap-drop ALL \
  --security-opt no-new-privileges:true --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --memory 1g --memory-swap 1g --cpus 1 --pids-limit 128 \
  --mount type=bind,src=/private/tmp/workspacex-standard-capabilities/apps/skill-sandbox/tests/legacy-container.mjs,dst=/legacy-test.mjs,readonly \
  --entrypoint node workspacex-skill-sandbox:e003 /legacy-test.mjs
```

Exit 0: `DEFAULT_PROFILE_LEGACY_RUN_OK`.

Cleanup `docker compose -f docker-compose.sessions.yml -p wx-e003 down --volumes` removed `wx-e003_sessions_socket`; all test containers used `--rm`. No production stack or other agent resource was changed.

## Peer interface boundary

The authoritative endpoints and limits are `packages/contracts/src/sandbox-session.ts`, generated identically for the Node service and Python adapter. Create is trusted gateway-only, then all session operations use `Authorization: Bearer <returned token>`; the capability must not enter model input or execution environment. This module exposes session create/delete, `/workspace` file write/read/list, read-only `/skills`, bounded execute and cancel primitives. It does not define main-run status, command/event persistence, approvals, interruption UX or artifact workspace UI.

Sessions expire/restart ephemerally. Durable artifact storage, tenant authorization at the gateway, run lifecycle and queue ownership remain with their existing modules. Resource limits bound the shared instance; per-session CPU/memory fairness is not claimed. The final dynamic host was LinuxKit arm64; other deployment hosts need the supplied probe/integration path before enablement.

## Python adapter contract-limit follow-up

The Python `HttpSessionSandbox` now consumes `generated/sandbox_session_schema.json` limits generated from the shared TypeScript contract. Default/max timeout and command/file size limits are not independently authored in Python. Command limits count UTF-8 bytes; oversized uploads fail per file before sending. Downloads require bounded canonical base64 and an exact integer byte count (booleans/floats rejected). Official BaseSandbox file helpers remain inherited unchanged.

From `apps/deep-agent-service`:

```sh
PYTHONPATH=src .venv/bin/python -m pytest tests/test_sandbox_backend.py -q
```

Exit 0: 26 passed, one existing google/genai deprecation warning; raw output `python-adapter.txt`. Before the change, two new tests failed: absent generated-limit consumption and noncanonical `YR==` accepted as a successful download. These are MockTransport/official inheritance tests, not additional real-container or deployment evidence. No main-run control behavior changed.

### Final bounded-directory delta

`maxDirectoryEntries=4096` is separate from skill package file limits and generated identically into Python and Node schema artifacts. `SessionManager.list` uses `opendir` bounded iteration and returns explicit `SESSION_LIMIT` on entry 4097; it never returns a misleading partial list. The regression creates 4097 entries, asserts rejection and confirms the lock/handle are released. Targeted manager + contract tests: 14 passed. The final image digest above was rebuilt after this change; both real session and default-profile legacy runners passed again and the dedicated volume was removed.

### Final local verification (2026-09-07)

The 4097-directory fixture initially exceeded Vitest's default 5-second timeout under shared host load. Fixture creation now uses batches of 32 operations and a 20-second test-only timeout; the production limit and rejection assertion are unchanged. Re-run: sandbox 23 tests passed in 690 ms, followed by successful TypeScript typecheck. Contracts: 22 tests passed (19 capability + 3 sandbox), followed by successful TypeScript typecheck. Python adapter and pinned-package loader: 39 tests passed in 11.74 s (26 sandbox + 13 package tests), with one existing Google SDK deprecation warning. Package-loader implementation belongs to WX-E004 and is committed separately.

## Container lifecycle reliability regression

The long-lived sessions service exhausted its unchanged 128-PID budget because Node
as PID 1 did not reap orphaned bubblewrap helpers. The opt-in sessions Compose service
now uses `init: true`; the legacy service, PID quota and isolation settings are unchanged.
The root-authorized `wx-native-files-test` was stopped and its project's volumes removed
before rebuilding the same project/container. The rebuilt container remains running
under the main agent's ownership for native-file tool verification.

Commands from repository root:

```bash
docker stop wx-native-files-test
docker compose -p wx-native-files -f apps/skill-sandbox/docker-compose.sessions.yml down --volumes
docker compose -p wx-native-files -f apps/skill-sandbox/docker-compose.sessions.yml run -d --name wx-native-files-test skill-sandbox-sessions
docker exec -i wx-native-files-test node --input-type=module < apps/skill-sandbox/tests/session-lifecycle-container.mjs
```

Result: exit 0, **160 real executions** in two sequential sessions (80 each, below the
128-execution session limit). The regression calls the actual running service over its
Unix socket and reads container `/proc` outside each sandbox. Baseline process count
was 3 with 0 zombies; after both 80 and 160 executions it was still 3 with 0 zombies.
Each execution returned HTTP 200, exit code 0 and the expected actual command output;
both sessions were destroyed. Raw output: `session-lifecycle.txt`.
