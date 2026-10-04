# Step 1 — fixed candidate manifest and tag freeze

Scope: source development and isolated tests only. No remote tag, image build,
host installation, production database access or traffic operation was performed.

## Backlog and implemented change

Reuse `release-candidate.ts` for exact manifest byte seals and
`cn-frozen-release-identity.mjs` for annotated tag bindings. The tag previously
omitted `expectedMainCnSha`, although dispatch validated that CAS baseline.
Include it in the existing binding so changing the baseline invalidates the tag.
No alternate manifest, release identity or runner framework is introduced.

## Inputs and outputs

Inputs remain exact source SHA, attempt, CAS baseline SHA, validated prepared
receipt hashes, Devapp evidence and immutable image digests. The fixed regression
fixture uses APP `9b25bfa65662b96c0826fe67506b562ea46aa6d0`, BASE
`ba6343199f3c834d6a198f83d0c771614292c82b`, release `2026.10.3-cn.1`.
Outputs remain the existing sealed manifest and serialized annotated tag binding;
the latter now includes the exact CAS baseline. Release is bound through the
exact manifest byte hash. Manifest validation requires all six digest references.

## Idempotency, failures and rollback

Identical validated inputs produce the same tag message. Changed baseline,
attempt, source, manifest hash or application digest fails tag validation. Changed
release, source, digest or whitespace fails the original seal. Mutable image tags
and missing services fail manifest validation. Existing remote tags lacking the
new baseline field fail closed and require a separately reviewed fresh attempt;
they must never be rewritten. There is no production rollback action in this
step because the freeze and validation functions do not alter production.

## Tests and evidence

`cn-fixed-candidate-freeze.test.ts` exercises the fixed candidate and the failure
cases above using existing production functions. Run together with the existing
identity and CLI tests:

```sh
pnpm exec vitest run --config .harness/vitest.config.ts \
  .harness/scripts/vm/cn-fixed-candidate-freeze.test.ts \
  .harness/scripts/vm/cn-frozen-release-identity.test.ts \
  .harness/scripts/vm/cn-frozen-release-cli.test.ts \
  --maxWorkers=1 --minWorkers=1
```

The integration writer records the actual command result and commit. Final
operational package hashes must be frozen only after all seven source packages
are integrated. This local fixture is not Devapp or production qualification.

Actual local result (UTC 2026-10-04): the command above ran with the pinned
`/tmp/cn-sop-toolchain/node_modules/.bin/pnpm` wrapper, exit 0: 3 test files,
40 tests passed, duration 18.77 seconds; start 15:58:37 UTC. `git diff --check`
returned exit 0. Initial run exposed four stale CLI fixtures omitting the new
baseline field; updating that single fixture binding restored all 23 CLI tests.
Source HEAD before integration: `4f2fe2c5724a607e2f3dc5dd2ece81a8754bc261`.
