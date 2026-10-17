# Approved one-time Shanghai metadata diagnostic

Refs #5813. This is a diagnostic, not a production release or migration.
The user approved landing/merging the reviewed workflow (including possible existing Devapp
main-push automation), then exactly one invocation after existing production-cn-promotion review.
This does not authorize a production release, SQL, restart, credential/IAM/sudo/Docker-group change,
or root fallback. PR #5810 remains separate.

Approved script SHA256: `2f2adc6b0bbc12e3cb07e7140abd1a376749ce1e82499deaa9902bbfae13d813`.
The source is byte-identical to the approved Library review package
`libfile_ab759910146881918eb5a8de9bf6f6e4` (ZIP SHA256
`e9c2497d96d8c62e1535da7049be43da0bafccb02145417638e6808224f061c3`).

The manual workflow only accepts main, checks out exact github.sha, validates the script pin,
uses the existing production-cn-promotion reviewer gate and production serialization group,
and runs as the existing runner service user with no sudo. Python deadline is 55 seconds;
outer timeout is 60 seconds plus 2-second kill grace; stdout is one JSON bounded to 16 KiB.
No automatic retry, cancellation, arbitrary arguments, source build, production prepare, activation,
SQL or new access configuration is added. The PR test workflow is hosted-Linux/offline only.

Target identity is bound first to ECS i-uf6ga92ewloganobbln6 via a fixed non-credential IMDS GET.
If it is denied/unavailable, nothing else is inspected; no token PUT, credential metadata or IMDS
setting change is attempted. Docker access uses only two bounded GET container-list calls through
the existing Unix socket, with project filter and drift detection. There is no container/image
inspect, exec, logs or env access. Code bytes are read only for hashes of four fixed trusted entry
paths. Config, runtime, baseline and receipt paths are stat-only: their contents and all secret/env
paths are not opened. Health reads only the fixed loopback endpoint; output fields are filtered.

The original review package passed 21 offline tests including its console packaging checks.
The repository suite retains 18 behavioral tests plus exact-byte and actual-workflow guard tests
(20 tests); it does not introduce the unapproved console/root fallback into this PR.
Reproduce with:

```sh
python3 -B -m unittest discover -s tests -p 'test_cn_single_host_readonly_diagnostic.py' -v
sha256sum scripts/cn-single-host-readonly-diagnostic.py
```

OBSERVED is never production admission. productionReady, productionAccepted, rollbackVerified,
databaseChecked and approvalGranted remain false. A file existing does not prove a usable rollback;
a reported source label is not verified image provenance. The embedded devapp-log candidate
41aa8271cd6d312af01ce5fece2b1c96f40b4e0f is explicitly historical context, not asserted current
Devapp/production identity. Main has advanced since that log. Actual release identity needs fresh
runtime and approval evidence; this workflow does not prepare or release that application.

Execution ledger is maintained on issue #5813: record intent before dispatch, then actual head/run,
review gate, target, timestamps and sanitized result. Unknown dispatch outcome must be inspected
before any action; the once-only invocation is not repeated for missing permissions or partial data.
No invocation has occurred when this source is submitted for review. Runner liveness, permission
and existing environment eligibility remain runtime facts, not assumptions. Log retention follows
existing repository policy; no retention/cleanup setting is changed.
