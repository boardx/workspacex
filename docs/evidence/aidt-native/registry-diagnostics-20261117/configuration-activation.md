# DevApp AIDT configuration activation

## Actual problem and selected scope

The authenticated pre-fix run [44028505612](https://github.com/boardx/workspacex/actions/runs/44028505612) logged in and opened `/aidt`, but courses returned `404 AIDT_COURSE_NOT_FOUND` and the never-created member-channel probe returned `404 MODULE_DISABLED`. This is an availability failure, not a successful group-workflow acceptance.

The normal replacement build [44026532271](https://github.com/boardx/workspacex/actions/runs/44026532271), application source `00120c5ff4d276ae01ac6b1ce91464fe4fb46af9`, failed during registry export: API and Sandbox reached `BUILD_TIMEOUT_API` and `BUILD_TIMEOUT_SANDBOX` after 3120 seconds, with large layer uploads unfinished. Agent, Postgres and Web succeeded, but the complete manifest and deployment were skipped. None of its three partial receipts is used by this operation.

This optional operation activates the configuration of the already validated complete application release. It does **not** rebuild or claim to update its business-code filesystem. The application revision remains `27b305e607281e54b4cf905269e30e26a35bee9e`; the workflow's control revision is recorded separately by GitHub. A new complete run/attempt tag identifies the changed image configurations.

## Fixed parent and verification

The parent is the byte-preserved `activation-parent-release.json` beside this document, independently checked against all six original artifact archives and five service receipts. `activation-parent-provenance.md` records the source evidence and limitations. The producer pins this exact file and its raw SHA256 in one selector; callers cannot select a different URL, path, image or parent hash.

Each child uses its corresponding same-repository immutable parent digest. Its controlled, empty-context Dockerfile contains only `FROM`, release/source labels, and, for API, `ENABLE_AIDT_MODULE=1` plus `ENABLE_PROJECT_MEMBER_CHAT=1`. Inherited nonempty or malformed `OnBuild` is rejected before a child build. The metadata build has `--network=none`; registry metadata and layer transfers still require the normal registry connection.

Fresh readback must establish all of the following before writing a new service receipt:

- The expected application source, new run/attempt tag, Linux amd64 platform, config digest and registry manifest digest.
- Identical parent/child RootFS and complete registry layer descriptors.
- Identical runtime configuration except the new release label and the API's two unique enabled module flags. Other environment entries and command, user, working directory, health, port and volume settings are preserved.

All five new service receipts must pass the existing same-source, same-tag aggregate validation. A failed role cannot produce a complete release manifest. No timeout increase, upload retry, mixed-attempt receipt, database change, permission change or host-policy update is introduced. Registry layer reuse and elapsed time remain runtime observations, not promises inferred from this recipe.

The default normal build path remains available, including the existing CN path from the develop baseline. The earlier API Dockerfile fix still applies to normal full builds; this separate operation configures an exact existing application filesystem instead.

## Explicit operation and acceptance boundary

The workflow option `aidt_configuration_activation` defaults to false. Activation requires a manual DevApp-only, new-tag, `build_only=true`, `service=all`, `enable_aidt=true` request with an explicit `source_revision` equal to the fixed parent's application revision. Invalid or incomplete selections fail before publication. Parent-based configuration activation is unavailable for ordinary images and CN/US targets.

After a successful complete build, the normal immutable-tag reuse deployment is a separate request with activation disabled and no source override. The new five-image manifest and its artifact bytes must be checked first. Deployment still uses the existing guarded native entry; no alternate SSH, SQL or privilege path is added.

Post-deployment acceptance must inspect the exact running release, independently observe the API's enabled module flags, and repeat the authenticated course checks. A random member endpoint returning `NOT_FOUND` instead of `MODULE_DISABLED` only distinguishes its gate: it does not prove two-person messaging, six-stage learning, model quality or classroom acceptance. Those remain separate tests. The human report must preserve the earlier failed results and any remaining unverified cases.

## Review state

Implementation and independent technical review are complete for this candidate. `PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests -p 'test_registry*.py' -v` passed all 86 tests. These include simulated Docker seams and actual offline source/plan workflow commands; no real registry publication is implied. The actual workflow environment scopes are parsed using the repository's existing vendored YAML parser. Removing the registry-prefix binding makes that same plan command fail before producing output. `actionlint` context validation and `git diff --check` also passed. The production change preserves the develop baseline's existing CN path.

Real image production, runtime flag observation and authenticated post-fix checks remain pending. This document is not human design signoff, a deployment receipt or a passed end-to-end result.
