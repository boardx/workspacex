# AIDT release packaging final read-only review

Scope: pending four release files in `/workspace/aidt-pr-20261117`. Final review was followed by root-authorized P2 remediation below. No workflow, Docker build/push, deployment, secret-value read, host mutation or new issue was performed.

## P2 remediation added after independent review

The initial opt-in rejected true+existing-tag but did not remember a known enabled candidate across a later false+production-tag request. Root authorized a narrow reserved-tag source guard, preserving installed host compatibility and permissions.

- Enabled releases now receive `runid-9000000000000000000<actual-attempt>`; disabled releases retain `runid-attempt`. The numeric namespace is accepted by the unchanged installed TAG regex. A real attempt already entering the reserved prefix rejects rather than colliding.
- `is_aidt_tag` examines only the final attempt component on valid short or legacy source-SHA tags. Any reserved tag requested for CN/US rejects at plan stage, regardless of current enable_aidt/build_only; production cannot consume the original known-enabled tag through this workflow by toggling enable false.
- `AIDT_RELEASE_ENABLED` is the plan's strict 0/1 release marker propagated to every service, while only Web public flags become 1. Producer verifies marker/tag consistency, Web flags equal release intent, devapp target and exact actual run/attempt. Disabled Web builds cannot mint enabled-namespace tags; non-Web images share the same enabled release tag with their public flags zero.
- `python3 -B -m unittest discover -s tests -p 'test_registry*.py' -v`: now **34 passed**, including ten opt-in tests. Added short/legacy namespace promotion counterexamples, all services in both flavors, reserved-attempt collision, default run-number false-positive counterexample, producer mismatch and wrong-attempt refusal, and ordinary-short-alias label-binding refusal.

This is a **source-level namespace release guard, not cryptographic flavor evidence**. It does not upgrade the installed consumer. Arbitrary external retagging/rebuilding is not authorized or attested. Precisely: unchanged resolve rejects a marker image requested through an ordinary *short* tag if its release-tag label differs; its legacy `sourceSHA-run-attempt` branch instead checks source SHA and does not enforce that label. Do not claim the short-alias test proves all external aliases safe. This limitation was reported to root and reviewers; no host/policy/root-wrapper or authentication scope was expanded to conceal it.

## Review findings

No new fail-open input path identified:

- Dispatch/call input `enable_aidt` is typed boolean, defaults false. Producer accepts only literal `true` or `false`; malformed/empty CLI values reject before outputs or base-image resolution.
- Producer resolves target first. True requires resolved `devapp`, including when branch implies CN/US through auto; explicit CN/US rejects even for build-only.
- True + existing tag rejects because old manifests do not attest build flavor. False + tag preserves the original tag behavior; summary explicitly says flavor is not attested. Default false does not claim a reused image was compiled with disabled flags.
- Web build args require two equal values, each exactly `0` or `1`. Enabled values require role=web and target=devapp, before git/Docker. Other service commands do not get public teaching build args. API runtime flags are not baked into its image.
- Workflow permissions, event condition, environment protection reference, concurrency, fixed wrapper and schema gates are unchanged. GitHub expression fallback uses string `'0'`; both `'0'` and `'1'` are nonempty strings, so Web preserves the plan output while non-Web receives 0.

Reusable workflow nuance: GitHub uses the **caller's github context**, not a synthetic always-`workflow_call` event. An already-manually-dispatched caller can enter the existing plan condition; a push/PR caller still cannot. Adding a default-false input does not change that pre-existing behavior. Official primary source: [GitHub reusable-workflow context](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#github-context). A CLI counterexample with literal `GITHUB_EVENT_NAME=workflow_call` tests only that literal value, not every reusable invocation.

Build intent is not an attestation. Neither the manifest nor image labels now contain a verified AIDT flavor receipt. Passing flags to an older source Dockerfile through `source_revision` may not compile the module; it remains diagnostic build-only and must not be reported as AIDT enabled. Production/reuse-tag behavior is not redesigned here. For this delivery use new build, all services, empty source_revision, actual reviewed merge SHA, then inspect build/manifest/runtime and actual `/aidt` behavior. No new required flavor receipt is falsely claimed.

## Exact post-CI / post-merge sequence (prepared, not executed)

1. Keep Draft until final head—including these packaging edits—is reviewed and CI concludes. User explicitly permits merge into develop after that. Read live PR checks and native branch policy; v5 source lists verify-control-plane, verify-affected, verify-full-compile, merge-gate, backend-required, queue-ready. Do not bypass native rules or create another issue (issue creation was denied).
2. Ready only the reviewed SHA. Existing pr-auto-merge runs on non-Draft opened/reopened/synchronize/ready/edited and requests native auto-merge with match-head-commit; any later push requires fresh review. Follow the actual merge/queue result, then read back `merge_commit_sha` and current develop SHA. Record which actual SHA is the release candidate.
3. Read live image-release workflow state/definition and native devapp protection/runners using existing metadata access; do not edit protections. CI green does not assert runner/host readiness. Optional existing non-deploying readiness lane below can establish fixed runner/sudo resource capability without extending it.
4. Obtain native host metadata review of the existing devapp policy/runtime/schema route described below. Do not read secret values or dump container env. Four narrowly allowlisted boolean statuses and pinned-file verification are sufficient for flag review. If no safe existing reader exposes them, report that limited unknown rather than inventing proof.
5. Once native guard readiness is established, launch the existing authorized shared-devapp target with explicit opt-in. New-build + deploy path:

```sh
gh workflow run image-release.yml --repo boardx/workspacex --ref develop \
  -f environment=devapp -f service=all -f build_only=false \
  -f enable_aidt=true -f tag= -f source_revision=
```

Dispatch accepts a branch, not an exact raw SHA. Read current develop immediately before and match the new run's head_sha to the intended candidate; branch movement must be reported, not silently attributed to the older PR. If an exact older candidate is required after branch movement, use original reviewed candidate branch or explicit build-only override, not a fake deployment SHA override. Source revision override cannot deploy directly.

Alternative separate build/activation: same input with build_only=true produces all images only; read the exact run attempt manifest and sourceRevision/tag/digests and original build intent/logs. Activation reuses that verified tag with enable_aidt=false (true+tag deliberately rejects) and build_only=false. This false says only “no new opt-in build requested,” not “reused image disabled.” Do not change tag to hide schema refusal.

6. Observe terminal workflow and host receipt. SUCCEEDED must correspond to candidate runtime image IDs/revision, successful native business probe and actual authenticated `/aidt` six-step/Chat journey. Any SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE, REJECTED, ROLLED_BACK, FAILED_OR_UNCERTAIN or missing receipt is a failure/pending result. Do not automatically retry migration/model spending or claim dispatch=completion.

## Optional existing readiness workflow: exact non-deploying parameters

`build-cn-release-artifacts.yml` already has `host_permission_probe=devapp`. At current source this selects only hosted source-pin/artifact upload and the devapp self-hosted metadata/fixed-entry check, skipping normal producer, registry probe and shared-images jobs. It executes no release command: uses bounded read-only helper, no-argument installed status, and `sudo -l` authorization queries. Do not substitute the older broad devapp-probe (which also has ASR repair and DB diagnostics).

Prepared command (not executed):

```sh
gh workflow run build-cn-release-artifacts.yml --repo boardx/workspacex --ref develop \
  -f host_permission_probe=devapp -f release_sha='<actual-reviewed-merge-SHA>' \
  -f release=0.0.0-aidt-readiness -f platform=linux/amd64 -f source_branch=develop \
  -f shared_images_only=false -f registry_probe_only=false -f shared_image_service=all
```

Replace placeholder only after merge readback. The lane checks runner account, Docker readability, fixed status entry, own-environment release permission and other-environment denial. If it reports a broader existing grant or denied own capability, report that result; do not modify sudoers/install scripts. A successful metadata probe does **not** expose or prove runtime flags, schema adapter policy, live DB ledger, browser probe quality or API seed.

## Existing native host gates to review; current state unknown

These are actual checks in deploy-registry-images.py / minimal-docker-release.py / schema-release-handoff.py, not new approval requests:

- devapp runner and native GitHub environment checks/reviewers if configured; installed fixed root-owned wrapper/closure and existing scope. No evidence currently proves missing permissions; scope cannot be expanded.
- Root-owned private `/etc/workspacex-image-release/devapp.json`; existing Compose project/application services, configured registry pull credentials, canonical `/run/workspacex-devapp-deploy.lock`, no unresolved `pending.json`.
- Existing composeFiles/envFile must match pinned SHA256 and expected running baseline. API service must actually map `ENABLE_AIDT_MODULE=1` and independent `ENABLE_PROJECT_MEMBER_CHAT=1`. A compose interpolation env file alone does not prove those values entered the container. No unrestricted env dump or change is authorized by the read-only task.
- Current source API startup normally seeds optional packs after listen. If existing `KERNEL_PLATFORM_SKILL_SELFHEAL=off`, an existing owner seed path is needed, not elevated API DB roles. Expected current packs are aidt-methods@1.3.2 and aidt-project-summary@1.0.2. Confirm seed success/current authorized catalog and thread mounting; health/listen alone is insufficient.
- Every API/Agent schema inventory is compared from actual baseline and candidate stopped-image contents. This PR includes five new migrations. Devapp also has this guard. No `schemaRelease` means schema drift refuses before application change; its actual presence is unknown, not presumed absent.
- If schemaRelease is installed, native policy requires complete schema-preparation plan, environment binding, root-owned distinct writer/verifier, pinned closure and 30–600 second timeout. Writer proof must include original backup-restore, baseline-compatibility, migration-ledger, candidate-acceptance bound to environment/tag/source/manifest/plan and actual private proof files, followed by independent verification and runtime probe. It owns migration-before-candidate-switch under canonical lock; uncertain outcomes retain pending and prohibit replay.
- Fixed business/browser verification, live health, actual image IDs, rollback/reconciliation and source pointer commit remain native gates. A stale document, hash written in a report, or optional schema config shape is not a live pass receipt.

If required native metadata/adapter/proof is unavailable, report the precise inability or refusal. Do not manufacture signatures, apply SQL through alternate channels, rewrite pins, grant roles, install sudo entries or invoke production. Existing user authorization for merge/devapp target remains sufficient for those target actions once original gates pass; no duplicate generic permission question is needed.
