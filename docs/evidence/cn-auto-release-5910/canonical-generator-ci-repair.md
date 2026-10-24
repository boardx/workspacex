# Canonical generated artifacts and historical test identity

New-head5fb79c752 CI failed `release-identity-linux` and `verify-affected` with
`COMMITTED_TOOL_BUNDLE_DRIFT`. Local independent review had verified the duplicate
compiler parameters, missing the already existing canonical generator. This was
an avoidable verification gap, not a production installation failure.

The repaired parity test invokes the unchanged canonical generator's `--check`;
it no longer repeats compiler versions/options. That generator rebuilt the
controller and migrator; snapshot query bytes stayed unchanged. The migrator
indirectly depends on fixed_transport through source_plan_authority. No minified
bytes were hand-edited and the existing drift gate remains enforced.

Owner verification: the previously failing cloud tool group plus focused parity
and permissions tests passed9/9; canonical all-three-bundle byte comparison also
passed in Linux arm64 with read-only frozen pnpm dependencies, tsx4.23.1 and
esbuild0.28.1. A preliminary Linux fixture with a floating esbuild0.28.2 was
rejected rather than counted as this proof; a later missing-tsconfig mount was
corrected without changing compiler options. These are local Linux fixture
results, not the new GitHub x64 CI result. Its disposable containers were removed.

`isolated-contracts` separately failed the historical BC sidecar tests because
their synthetic observer read the current browser source under an immutable old
tool/profile pin. Production sidecar revisions and pins remain unchanged. The
fixture now supplies the exact7833-byte browser blob from
aa36786188de51a0dc11b15cc1ffa2d192666555, verifies its pinned SHA256, and never
executes it. A new counterexample substitutes the current browser and requires
TOOL_OR_CASE_PIN_CHANGED with zero sends and zero saved receipts.

Parent and independent sidecar runs passed16/16. The original observer passed
10/10, parent complete tool suites passed102/102 after regeneration, parent
canonical `--check` and diff check passed. Logs:
`/tmp/cn-canonical-generator-cloud-tests.log`,
`/tmp/cn-canonical-generator-linux-frozen-check.log`,
`/tmp/cn-target-business-historical-independent.log`,
`/tmp/cn-historical-browser-parent.log`,
`/tmp/cn-generator-parent-tool-tests.log`,
`/tmp/cn-generator-parent-observer-tests.log`.

New full CI is still required. No installed host file, key, database, service or
accepted production ref changed as part of this repair.
