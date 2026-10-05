# Fixed APP native Compose emitter supplement

This source-only supplement closes native Compose rendering for the maintenance candidate. It reuses `createCloudCompose` rather than rewriting its service configuration. The complete frozen APP `writeRuntimeBundle` rule adds `networks.default = {external: true, name: projectName + '-runtime'}`. A fixture-created `project_default` network is not equivalent. The emitter neither creates that network nor alters production networking.

## Package backlog

- Complete: pure production-only renderer, strict stdin CLI, fixed APP/release/platform binding, native five-service Compose output, external runtime network rule.
- Complete: local standalone CJS bundle compiler; frozen APP blob drift rejection, dependency/source/lockfile hash sidecar, create-once output, real inherited-FD CLI execution test.
- Host integration: root profile must bind the installed CJS bytes, exact Node binary, protected deployment configuration and offline manifest, and candidate project/runtime refs. The host owns private file provenance, fixed FD execution, baseline exclusion and live network/container verification. Emitted JSON alone proves none of those host facts.

## Protocol

Input is exactly `{schemaVersion: 1, sourceRevision: APP, config, manifest, options: {projectName, runtimeDirectory}}`. Only APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0`, release `2026.10.3-cn.1`, platform `linux/amd64`, production configuration and canonical digest-pinned manifest are accepted. Config schema accepts only secret references, and the emitter never reads their values. The caller authenticates the protected bytes before passing this in memory through stdin. It must bind the project/runtime values to its root profile and reject baseline aliases.

Output is one JSON line containing `{name, services, networks}` with the exact native external-network rule. Application ports remain loopback mappings, API-to-agent uses `http://agent:8000`, sandbox and session sandbox remain network `none`. No caller-selected network field, renderer module, command or host transport is accepted. Invalid JSON, oversize input (>1 MiB), unknown fields/args and validation failures return status 1, no stdout, and only `CANDIDATE_COMPOSE_REJECTED` on stderr.

## Local build and evidence

Run `node .harness/scripts/vm/build-cn-candidate-compose-source.mjs /tmp/candidate-compose.cjs`. It uses the existing lockfile's esbuild 0.24.2, verifies the exact frozen APP Git blob identities of compose/config/storage/release/image-reference/runtime-bundle, bundles all non-builtin dependencies locally, and creates the CJS plus `.source-closure.json` once with mode 0600. The sidecar records source/dependency/lockfile SHA-256 and final bundle SHA-256. It grants no root installation or execution authority.

The CLI runs as `node /proc/self/fd/N` through a host-authenticated inherited descriptor and accepts no argv. Its imported TypeScript source is inert. Rendering is deterministic and performs no file write, subprocess, network request, image pull/build or SQL. Compilation fails closed on any frozen source drift or a non-reviewed compiler version; output reuse is rejected. There is no production state to roll back.

2026-10-04 UTC: `pnpm --filter @repo/cloud-deploy exec vitest run test/cn-candidate-compose-source.test.ts`: 11/11 pass (625 ms). Real local bundling plus inherited FD execution produced byte-equivalent native Compose; negatives cover source/platform/release/profile/path/unknown fields/inline secrets, malformed and oversize JSON, forbidden argv and create-once overwrite. Existing authoritative serverless RDS no-TLS configuration remains accepted without relaxing network or sandbox assertions. Package `tsc --noEmit` and scoped `git diff --check` passed. Ephemeral logs: `/tmp/cn-compose-source-tests.log`, `/tmp/cn-compose-source-typecheck.log`.
