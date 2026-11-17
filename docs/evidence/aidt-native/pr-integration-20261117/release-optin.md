# AIDT DevApp Web release opt-in implementation

Implemented in shared worktree `/workspace/aidt-pr-20261117`; no commit made by this subtask (other agents have unrelated pending edits).

Files owned/changed:

- `.github/workflows/image-release.yml`: `enable_aidt` boolean, default false in dispatch/call schemas; plan outputs `aidt_web_enabled`; build step derives two public env values only for Web, sends explicit 0 for other services. Event admission, permissions, concurrency, deployment environment/wrapper unchanged.
- `scripts/registry-images.py`: plan requires exact `true`/`false`, resolved devapp target if enabled, new tag if enabled; no existing manifest flavor attestation exists, so `enable_aidt=true + tag` rejects `AIDT_REQUIRES_NEW_TAG`. Enabled candidates have a reserved numeric attempt prefix `9000000000000000000`: tag `runid-9000000000000000000<actual-attempt>` remains compatible with the installed host TAG regex; ordinary tags remain `runid-attempt`. Production plan refuses that namespace even with enable=false and on both short and sourceSHA-legacy forms. Actual run-attempt collision with the prefix refuses rather than silently reinterpreting. Build validates strict 0/1 release intent, matching namespace, exact actual run/attempt and Web pair, and devapp-only enabled release before publishing. Only Web Docker commands receive two public build args. Reuse-tag summary says it does not attest build-time flavor.
- `deploy/aliyun/images/web.Dockerfile`: two builder ARGs default 0, ENV before `next build`; runtime stage/API image unchanged.
- `tests/test_registry_aidt_opt_in.py`: ten tests include real plan CLI valid/invalid inputs, resolved targets, automatic event/tag refusal, reuse refusal, reserved short/legacy namespace production refusal with false/true opt-in and build-only values, exact actual run/attempt and namespace/flag mismatch counterexamples, reserved-attempt collision, numeric-run-ID false-positive counterexample, ordinary-short-alias release-label refusal, actual generated Docker command argument capture with mocked subprocess boundaries for all services in both release variants, unchanged non-Web public flags, strict values/pair validation, default-off workflow/Dockerfile handoff.

After final head is reviewed/CI-green and merged, intended new-build input is:

```sh
gh workflow run image-release.yml --repo boardx/workspacex --ref develop \
  -f environment=devapp -f service=all -f build_only=false \
  -f enable_aidt=true -f tag= -f source_revision=
```

This command is documentation only; no dispatch/build/push was performed. API runtime flags `ENABLE_AIDT_MODULE` and `ENABLE_PROJECT_MEMBER_CHAT` still require real existing host configuration. Build flavor does not authorize shared state, roles, migration, or extra model spending. No host policy/permission/config changes were made. Production opt-in is rejected.

Verification performed:

- `python3 -B -m unittest discover -s tests -p 'test_registry*.py' -v`: **34 passed** after final namespace guard (includes ten opt-in tests; supersedes initial 31).
- `python3 -B -m unittest discover -s tests -p 'test_release_branch_policy.py' -v`: **9 passed**.
- `python3 -B -m unittest discover -s tests -p 'test_alias_registry_images.py' -v`: **5 passed** after final namespace guard.
- Vendor YAML parser parsed workflow; both boolean inputs default false: passed.
- `git diff --check`: passed.
- Adjacent `test_deploy_registry_images.py`: **16 passed, one existing environment error**. `test_missing_policy_never_pulls_or_deploys` expects FileNotFoundError but this container's `/` uid is 65534, so root-owned trusted path checks first throw `ValueError: UNTRUSTED_HOST_PATH`. Reproduced exact same outcome with original develop `4060bcf...` deploy consumer, preserving the same live root metadata. Consumer guard and this test were not weakened or edited. All schema-diff refusal/adapter/routing tests passed. This suite must not be described as entirely green.

No real Docker images, registry writes, host access, environment mutation, model calls, deploy receipts or online AIDT acceptance were generated.

Final independent-review boundary: the numeric namespace is a source-level CI-entry guard, not a signed build-flavor receipt or a host protection upgrade. The ordinary short-alias label regression is proven; unchanged legacy sourceSHA alias resolution checks source rather than the release-tag label, so arbitrary external legacy aliasing/manual retagging/direct host activation is not attested or authorized. Root reviewed and accepted this deliberately narrow scope without expanding host policy or credentials. Existing manifest/source/digest checks remain as before. See `/tmp/aidt-release-final-review-20261117.md` for exact readiness/dispatch inputs and existing native runtime/schema checks whose live state is still unknown. No further writes from this subtask after this final report.
