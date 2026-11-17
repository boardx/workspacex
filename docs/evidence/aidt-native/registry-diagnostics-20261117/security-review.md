# Bounded registry diagnostic — independent security/publication review

**ACCEPT for the reviewed source bytes below; no remaining P1/P2 blocker identified.** This is a subagent audit projection, not a formal human GitHub approval or proof that an actual registry diagnostic succeeded. Commit binding remains pending.

- Branch `worker/aidt-registry-diagnostic-20261117`; base `27b305e607281e54b4cf905269e30e26a35bee9e`.
- Read-only review: no source edits, workflow dispatch, Docker/registry command, model request, credential-value read, deployment or permission change by this reviewer.

## Checked scope

- The new workflow inputs default to false/empty. Setting either selects only the new GitHub-hosted diagnostic job; old host-source, shared-images, tiny-probe and validate paths all exclude either control. Their dependent host/build/seal jobs consequently skip.
- Real workflow guard Python is before authentication. It requires sized=true, probe-only=true, shared=false, host-probe off/empty and a valid existing release tag. Invalid combinations do not acquire credentials. Workflow remains read contents permission; no production environment/host/runtime/API/schema path added.
- All existing five service tag operations are manifest inspect reads. Exported metadata is restricted to descriptor kind/digest/size; raw Ref, URLs, annotations, Config.Env/history and unknown Docker text are excluded. Mixed missing+auth/transport failure cannot count as confirmed absence.
- The only remote write is a fresh run/attempt-specific API repository tag acr-probe-<run>-<attempt>-sized, which is outside normal release tag grammar. Its absence must first be confirmed. Exactly 32 MiB random synthetic payload is built FROM scratch with network=none, never application or user material. Actual wire bytes also include compression/manifest overhead; do not claim exactly 32 MiB network traffic.
- Existing ACR login is reused opaquely through Docker CLI/config. Script requires GitHub-hosted manual job markers, rejects Docker host/context/TLS overrides and validates code SHA. No registry token parsing, raw credential display or new grants.
- Local image removal is limited to this random fresh canary reference after push, followed by absent-tag and absent-ID checks. There is no remote DELETE, old release-tag overwrite or existing application-image removal. Remote canary remains for evidence; no automatic cleanup of tags.
- CLI subprocess stdout/stderr is captured with a 2 MiB bound; only fixed error codes and whitelisted hex layer IDs/statuses/relative time are emitted. Output paths refuse existing files/symlinks and use exclusive creation with mode0600. Safe parser errors do not echo arbitrary arguments.
- App build/push budget code and open PR#6684 remain untouched. No deploy/host/policy/runtime/paid-model behavior added.

## Deadline finding resolved

Initial per-stage budgets could exceed the 10-minute job, risking cancellation before the final receipt. The fixed script sets a 420-second diagnostic-wide ContextVar deadline; every Docker command receives min(stage budget, remaining time), timeout is classified DIAGNOSTIC_DEADLINE when applicable, and safe partial progress is written to the exclusive receipt. A virtual-clock regression reaches push with only158seconds and verifies deadline failure, one push call, no pull, retained progress and ContextVar reset. This leaves the workflow time for cleanup/artifact handling; arbitrary external cancellation can still interrupt artifacts and is not claimed impossible.

## Independent validation on these bytes

- python3 -B tests/test_registry_upload_diagnostics.py: 13/13 passed. No Docker, registry credentials or network; actual pipe-reader tests use bounded local Python child processes.
- python3 -B tests/test_registry_upload_diagnostics_workflow.py: 9/9 passed. Uses actual YAML, narrow GitHub expression coercion, and the actual inline guard; includes legacy default paths, reusable null inputs, mutually exclusive new modes and authentication ordering.
- git diff --check passed for tracked workflow changes. Script/test formatting additionally inspected; no repository writes from review.
- The two new historical diagnosis files were read: upload-diagnosis-readonly.md and upload-diagnosis-proof.json. They retain public run/job/source/tag/layer/time metadata and explicitly distinguish known timeout facts from unproven network cause. No model keys, credentials or private application material observed; they are historical investigation evidence, not a success receipt for this new mode.

## Required reporting limits

- One push CLI invocation and no script-level retry do not prove Docker daemon internal retries are disabled.
- Absent local tag/image ID plus matching pulled image ID does not prove uncached layer-byte transfer; pullMayReuseLayerCache remains true.
- 32 MiB scratch success would not prove application compilation, all original manifests complete, large base-layer throughput, host readiness, schema admission, DevApp UI or production deployment. A failed or timed-out push is an uncertain remote canary outcome; retain the exact unique tag and receipt, do not automatically replay or delete it.
- Future branch dispatch must bind run.head_sha to the reviewed commit; input release_sha alone does not pin the workflow checkout. New workflow controls already require an explicit manual invocation.

## Reviewed SHA256

- `.github/workflows/build-cn-release-artifacts.yml`: `1038cc00eb08521be6d918cc0b3f2e34bc6c024f7ac178fb15d81c80896b5f60`
- `scripts/registry-upload-diagnostics.py`: `4c48a88d44bf0265ba9610134fecf5a03dc666c7e4d0795407b620fbf1d39541`
- `tests/test_registry_upload_diagnostics.py`: `518254cca0847c5978a48c9212f3a25de4e8739ec7c94f6c33673a5dda51dfab`
- `tests/test_registry_upload_diagnostics_workflow.py`: `3a39ccb2b53391faed4660c44e1e64f3ead95e3d8ede61708e9cb82d9bfa56bc`
