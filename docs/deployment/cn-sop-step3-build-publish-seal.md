# Step 3 — immutable build, publish, seal lifecycle

Scope: source development and isolated process tests for the frozen maintenance release. Entry remains `.harness/scripts/vm/publish-cn-release.sh`; stage admission remains the trusted candidate entrypoint and the existing [artifact-only boundary](../../.agents/skills/workspacex-cn-release/references/preflight-contract.md#artifact-only-stage-boundary-5319). This package does not require baseline replay for artifact build or grant production execution permission.

## Package backlog

- Complete: preserve exact source checkout, digest-pinned base images, immutable application tags, registry revision readback, six-image manifest and seal.
- Complete: EXIT, TERM and INT terminate only tracked build process groups, join owned direct children, then remove temporary workspace. TERM-resistant groups receive KILL after a bounded grace period. Completed jobs are removed from ownership immediately after wait.
- Remaining operational evidence: reviewed real registry authentication/build/push/digest evidence. No real build or push was performed in this development package.

## Inputs and outputs

Inputs remain the exact 40-hex revision, release identifier, reviewed digest-pinned images, registry prefix, immutable source checkout, protected runner identity and existing toolchain. Output remains immutable manifest/seal and the `CN_RELEASE_PUBLISHED` event only after canonical validation succeeds. Signal failure emits no publication success event; TERM exits 143 and INT exits 130. Other EXIT status is preserved.

## Idempotence, failures and rollback

Existing immutable tags are reused only after revision readback matches. A lost push response can be recovered by a successful registry pull with matching revision; only documented transient errors receive bounded retries. Existing manifest bytes must match; existing seal must validate. Failed or interrupted builds cannot produce a success event. Cleanup neither deletes immutable registry objects nor changes production pointers. Retry goes through the trusted stage gate; production rollback belongs to the maintenance adapter, not this publisher.

Monitor mode isolates each background build's process group, so cleanup includes Docker clients and their ordinary descendants without broad host-wide process matching. It sends TERM, waits up to two seconds, escalates remaining owned groups to KILL and calls wait for each owned direct child before removing logs/workspace. The kernel delegates orphan descendant reaping to host init; tests explicitly prohibit running descendants and allow an already killed zombie awaiting init. This cannot cancel server-side work detached by an external Docker daemon and does not claim such cancellation.

## Local test evidence

2026-10-04 UTC: `pnpm exec vitest run --config .harness/vitest.config.ts .harness/scripts/vm/publish-cn-release.test.ts` passed 18/18. Four real local process cases cover TERM, INT, nonzero EXIT and TERM-resistant descendants; each verifies preserved status, no running owned children/descendants, removed workspace and surviving unrelated sibling process. `bash -n .harness/scripts/vm/publish-cn-release.sh` passed. Log: `/tmp/cn-step3-tests.log` (ephemeral); committed tests are the reproducible evidence. No Docker, production database, host install or network mutation was used.
