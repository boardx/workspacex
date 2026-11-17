# DevApp upload diagnostics — 2026-11-17

Refs #6689. Native AIDT is merged at develop 27b305e607281e54b4cf905269e30e26a35bee9e; DevApp is not released. All five images in build-only run 44000938132 built successfully but their registry pushes reached 720 seconds; no manifest/deployment was produced. Existing PR #6684 owns a separate upload-budget proposal, which this change does not modify or duplicate.

Current existing tiny scratch probe 44003858952 succeeded: upload and readback preserve the exact image ID, confirming the basic managed login/small-write path. It cannot prove large-layer transport. Host read-only probe 44004442856 succeeded on devapp-x64 with Docker-readable status and scope-restricted fixed release entry; private policy remains unreadable and API flags/schema adapter remain unverified. The public UI marker is d98613266de68a57c9b73b471fd547ffb81092dc, /aidt is 404, API health reports the 20261114130000 migration baseline. These do not prove a new AIDT release.

This optional diagnostic extends only the existing manual workflow: defaults preserve legacy paths; enabling its new controls blocks host/application/production jobs, and conflicting combinations fail before login. On a hosted runner it reads five original-tag manifests and tries exactly one new random 32 MiB scratch layer at an undeployable acr-probe tag. Push/pull are bounded to 180 seconds each within a 420-second total deadline. It never changes host policy, roles, application images, deployment tags, production runtime or schema.

Unknown Docker output/URLs/history/environment are not emitted; only validated descriptor geometry, fixed state codes and layer progress are reported. A partial exclusive mode0600 JSON receipt is retained on failure. A local tag and image-ID removal followed by exact readback is checked; layer-cache reuse remains explicitly possible. This is a diagnostic, not a real application/AI/classroom acceptance.

Fresh local verification: 56 registry-related unittest cases plus 9 existing release-branch cases passed; independent 22-case diagnostics/YAML subset passed. Raw process outputs are retained in /tmp; verification and security reports here include reviewed source identities. Root strict OSS baseline gate must pass before publication, with no scanner/baseline changes. Real managed diagnostic and subsequent exact-source release outcomes are reported separately on the PR.

## Actual sized probe and explicit alternative

Run 44006165671 used reviewed diagnostic source 1d1e131d89996f416b31f0863a570cb82e9817fc. Its archive hash was independently matched to GitHub. All five original-tag manifests reported missing; a new 33,554,432-byte scratch layer remained incomplete and daemon push reached 180 seconds. Pull was not run. This is a real failed transport test, not a successful deployment, and does not prove a particular network/registry fault. See daemon-sized-probe.md/json.

The diagnostic now permits an explicit BuildKit registry exporter comparison; default docker remains unchanged. It never falls back or retries. Export is bounded to the same 180 seconds within the same global 420 seconds, preserves single-platform Docker media type, and uses only generated config/manifest digests from private metadata. Successful registry readback and digest-pinned pull must match the exact generated image ID. The actual alternative test is still separate from local mocked CLI validation.

The existing DevApp-only read-only host report also gains a best-effort API readiness projection. It only lists four known DevApp compose projects and inspects a unique matching running API via GET. It emits two flag states, not environment values or credentials; ambiguity remains UNKNOWN. Other environments/default invocation are unchanged. No private policy, SQL, sudo allowance, host config, runtime flags or role is changed.

Fresh local final checks for this extension: 61 registry/diagnostic cases, 22 image-release/readiness cases and 9 release-branch cases all passed; OSS baseline-external matches remain zero, diff check passes. Source reviewers independently tested A/B and privacy boundaries.
