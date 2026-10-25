# Shared immutable release images

Goal: build Web, API, Agent and Sandbox once for an exact validated source SHA; promote the same digests, injecting environment configuration at startup. Separate service images remain; this is one release image set, not one combined container.

Architecture: reuse `build-cn-release-artifacts.yml` and `hosted-release.py`; do not create another builder. Same-origin `/api` and WebSocket handling already exist in the Web release image. The existing cloud Compose renderer consumes manifest digests and private per-service env files without a build section. Keep these implementations authoritative.

## Implementation and verification

- [x] Add tested explicit main/develop source admission, preserving main as the legacy default. Source branch affects ancestry admission and plan hash, not build identity or build arguments.
- [x] Add shared build entry after successful develop push integration. Read back current backend workflow/run attempt; reject stale events, failed/cancelled/skipped or absent validation. Manual builds use the same read-only validation.
- [x] Reuse existing immutable tag lookup, build-identity labels, independent digest readback and canonical manifest/seal generation. Existing tags with conflicting build inputs remain rejected rather than overwritten.
- [x] Keep automatic builds behind repository variable `WSX_SHARED_IMAGES_ENABLED=true` until cutover is accepted; an explicit manual build remains possible. Build jobs cannot activate production.
- [ ] Configure and prove a registry reachable from the build runner, Devapp and China; do not infer public access from a VPC endpoint. Supply the reviewed pinned base images, existing authentication and canonical verifier configuration.
- [ ] Install and verify trusted Devapp image consumer, runtime configuration, isolated candidate startup, real browser acceptance and exact-digest rollback. Current backend-gates deploy still invokes the source-based trusted wrapper. It is not switched by this patch.
- [ ] Adapt protected CN preparation to consume the same verified artifact rather than rebuild; retain source identity, installed-tool checks, preflight, migration, approval, activation and rollback. Current CN main admission is unchanged.
- [ ] Perform a real manual artifact build, then Devapp acceptance and CN preparation using the same digests. Only then replace the old source deployment and enable automatic builds. The final dependency graph must build before deployment; this additive producer currently follows the complete backend workflow, including its existing deployment.

## Configuration boundary observed 2026-10-24

`production-cn-build` exists but its GitHub variables and secrets lists are empty; repository variables contain only COORD_GATEWAY_URL. No real image publication was attempted. Existing shared producer authentication accepts reviewed Hong Kong ACR endpoints; the existing CN failed run referenced a Shanghai VPC registry. Choosing and proving the shared registry is required; this patch does not relax endpoint authentication or alter production permissions.

The reusable producer's requirements remain in `.github/workflows/build-cn-release-artifacts.yml` and `scripts/aliyun-release-auth.py`: registry identity/probe, digest-pinned base images, edition-specific authentication, and canonical control closure. Do not paste credentials into issues or artifacts.

## Evidence boundaries

Local producer tests use synthetic Docker/Git/Node process results; they prove admission, input identity and command construction, not real registry publication. Cloud Compose/release tests prove renderer and verifier behavior with fixtures, not live deployment. Linux handoff tests require Linux atomic `renameat2`; macOS failure of that operation is not a production defect and must not be turned into success.

This is an additive producer slice of issue #5909. It does not claim completion of the all-environment delivery migration or production activation.

Local verification: Linux Python 3.12 producer/handoff 65 passed; harness source/admission/runtime regression 12 passed; cloud Compose/release 14 passed; cloud-deploy typecheck passed. Independent review GO after fixing the manual source admission. CI and real registry/deployment acceptance remain pending.
