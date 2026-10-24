# DevApp / CN registry image release implementation plan

**Goal:** GitHub-hosted Runner builds once and pushes immutable ACR tags; either environment deploys an explicit tag, verifies, and automatically restores its previous images on failure.
**Architecture:** Reuse existing Dockerfiles/service map and the single-host image/schema verification engine. Add a registry producer, a fixed installed host entry, and one push/manual workflow. Keep existing deployment paths behind the inverse cutover flag until each host is prepared. No PR validation dependency. Deployment verification remains mandatory.
**User-approved scope:** This conversation's build → ACR → environment/tag → verify → rollback flow. DevApp and CN. PR checks may be skipped; this does not disable runtime checks.

## Tasks
- [x] Add failing regression cases for candidate startup failure, rollback failure, cancellation, registry tag/source mismatch, and missing host configuration.
- [x] Add opt-in automatic rollback and ACR provenance to `scripts/minimal-docker-release.py`; preserve existing archive callers and schema guard.
- [x] Add `scripts/registry-images.py` for five existing Dockerfiles, unique source/run/attempt tags and complete manifests.
- [x] Add fixed `scripts/deploy-registry-images.py` entry: trusted per-environment config, shared host lock, pulls before mutation, pinned config, persistent current image override, runtime/business checks.
- [x] Add build/deploy workflow for develop→DevApp and main-cn→CN, plus manual environment/tag selection. Hosted runners build; existing self-hosted runners consume.
- [x] Gate legacy automatic writers with the same cutover switch, document installation/config and perform focused tests and independent review.
- [x] Configure hosted-builder ACR access and install scoped fixed entries on both real hosts.
- [x] Verify fresh ECS pull credentials and actual full layer downloads on both hosts.
- [x] Inventory live/candidate schema bytes and read actual database migration history.
- [x] Resolve the initial rollout version boundary: user chose current-version runtime conversion, with database upgrade separate.
- [ ] Prepare DevApp application Compose baseline, fixed business probes, CN admission adapter and real host policies.
- [ ] Execute actual environment deployment, business verification and recovery acceptance before enabling automatic cutover.

```mermaid
flowchart LR
  A[Hosted build and ACR push] --> B[Both hosts download exact tag]
  B --> C[Schema and database inventory]
  C --> D[Initial version boundary]
  D --> E[Runtime preparation]
  E --> F[Deploy and business verification]
  F --> G[Rollback acceptance]
  G --> H[Enable automatic releases]
  classDef tested fill:#ddd0ff,stroke:#7950b3
  classDef blocked fill:#ffd6d6,stroke:#c92a2a
  classDef pending fill:#eee,stroke:#888
  class A,B,C tested
  class D tested
  class E blocked
  class F,G,H pending
```

Actual initial candidate inventory: DevApp has seven pending database migrations,
CN sixteen. The candidate changes accounting column types; image recovery alone
cannot restore database semantics. The image-only schema guard remains enabled.
The user chose to build each existing environment's application version through
the hosted producer first and keep database upgrades separate. Added a build-only
exact source selector: control scripts remain at the workflow revision, while
Dockerfiles, application context, revision labels and tag identify the selected
source. Source overrides cannot deploy. The source selector and wrapper binding
have regression coverage; both current-version baseline builds now passed; real-host rollout remains pending.
See the dated evidence document for actual host observations.

## Constraints / rollout boundaries
- Do not alter database volumes, run migrations, or fabricate archive/approval evidence. Schema changes stop before activation.
- Existing DevApp uses systemd for API/Web: it needs a prepared full application Compose runtime before cutover; the dependency-only root compose is insufficient.
- Existing CN image namespace is reachable through a VPC address; hosted builders require a configured public registry endpoint and credentials. Do not invent them.
- Use existing environment locks and install a root-owned fixed deployment entry; never run checkout code through sudo.
- Production activation is not claimed without actual cloud and public business verification.

## Verification
Run stdlib Python regression suites, workflow structural checks, shell syntax checks, and report real cloud configuration limits. The checkout has no node_modules, so pnpm readiness/tick currently fail with `tsx: command not found`; per user direction broad pre-PR checks are deferred.

## Execution evidence and decisions
- Reused the existing checkout, fetched latest main, started `codex/unified-image-release` at `4e64506e3`; no new worktree.
- First regression run failed on the new rollback assertions; existing archive behavior remains opt-in unchanged. Subsequent 19-case engine suite passed before adding two further cancellation/digest cases.
- Producer 6/6 and host policy 5/5 passed. Python compilation, shell syntax and workflow YAML parsing passed.
- Independent review found and fixed recovery overlay/config-hash drift and stale automatic deployment ordering.
- Local real-Docker fixture correctly refused to claim Linux GitHub acceptance on macOS (`LINUX_GITHUB_ONLY`); actual Linux workflow dispatch remains required.
- GitHub ACR username saved from the user's console screenshot; user saved password directly. Public registry/namespace variables saved from screenshot and existing CN configuration. No secrets copied into repo.
- Public access initially disabled (user screenshot); user explicitly approved authenticated ACR access from all IPs. UI control can enumerate tabs but repeatedly times out on page/native interactions, so no browser-side cloud mutation was claimed.
- Implementation uses existing Dockerfile defaults resolved once to digest pins when optional base overrides are absent.
- Cutover stays disabled until host preparation and actual deployment/rollback evidence exist. DevApp currently lacks application Compose baseline; no systemd/data migration is performed implicitly.

- Final local engine regression: 21/21 passed (251s); registry 6/6 and policy 5/5 passed.
- Actual GitHub Linux Docker/Compose/HTTP integration succeeded: https://github.com/boardx/workspacex/actions/runs/40075718728 . Includes failed candidate → automatic rollback → subsequent successful release and owner-only cleanup.
- Official actionlint v1.7.12 checksum verified; new/modified build and integration workflows passed its checks. Corrected job-level `runner.temp` context after GitHub dispatch validation rejected it; no registry call occurred in that rejected dispatch.
- Independent final review: no remaining actionable findings; systemd recovery grace increased to360s.
- User enabled public ACR and removed whitelist per console semantics; public `/v2/` now responds401 with an auth challenge bound to the expected Shanghai instance. This is network reachability, not credential/push proof.

Current host preparation blocker: DevApp current-version preload reached its free-space guard after four application pulls. Targeted cleanup of this task's unused newer candidate was submitted; result must be read before retry. CN baseline preload result also remains to be collected.
