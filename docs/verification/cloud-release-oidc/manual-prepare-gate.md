# Manual preparation admission recovery

Recovered PR #5512 from `83244c8261ec127224913074d09d87df64daccf8`;
observed main `1762bcc658567d2b8e9681a2d0c884c58c0c231f`.
Both contained backend-gates successful-main workflow_run admission to production
self-hosted export/build/prepare. Manual dispatch also admitted other refs.
The new guard removes workflow_run, requires workflow_dispatch at refs/heads/main
before scheduling the job, and repeats that check at the start of both steps
containing sudo. Explicit source SHA, ancestry, installed-byte comparison,
preparation-input checks, host verifier, frozen-tag controls, production environment
and non-cancelling production concurrency remain intact. Locks serialize operations;
they do not prove rerun or multi-attempt idempotence. Host preparation is a privileged
operation even when public traffic is unchanged.

## Offline evidence

- `python3 -B -m unittest discover -s tests -p test_prepare_manual_gate.py -v`
  executes actual workflow Bash with fresh credential-free environments and local
  gh/git/sudo sentinels. Invalid automatic events, branch/tag/missing refs and SHA
  errors reach no command boundary. The legal case stops at the first sudo sentinel.
- `./node_modules/.bin/vitest run --config .harness/vitest.config.ts .harness/scripts/vm/cn-release-candidate-workflow.test.ts .harness/scripts/vm/cn-production-promotion-workflow.test.ts .harness/scripts/vm/cn-promotion-prepared-receipt.test.ts`
- `node --test .harness/scripts/vm/cn-checkout-offline.selftest.mjs .harness/scripts/vm/cn-domestic-checkout.selftest.mjs`
- `python3 -B -m unittest discover -s tests -p test_release_failure_matrix.py -v`
- `git diff --check`

The original candidate Vitest contract invokes the new Python test, so existing
harness CI exercises it without adding an automatic workflow. No cloud, registry,
production sudo, dispatch, deployment or token issuance is simulated as live proof.
Initialization quick checks passed using pnpm@9.15.0, /tmp caches and
ELECTRON_SKIP_BINARY_DOWNLOAD=1 after Electron download ECONNREFUSED; desktop runtime
and full init --full were not verified.

Current recovery results: all 128 Python tests passed (includes the 6 new admission
tests), the 3 related Vitest files passed 23 tests, and the direct domestic-checkout
selftests passed 12 tests. The 9 release-failure tests are included in the Python
128, not additional unique tests. Independent mutation checks rejected removing
one/both step guards, relaxing the job ref and restoring workflow_run admission.
Actionlint 1.7.7 accepted prepare/release/artifact workflows with shellcheck and
pyflakes disabled; git diff --check passed.

Full Python recovery command: `python3 -B -m unittest discover -s tests -p 'test_*.py' -v`.
It required a local official Node v22.20.0 binary, whose downloaded linux-x64 tar.xz
SHA256 matched Node's SHASUMS256.txt:
`00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc`.
`npm ci --prefix control-runtime --ignore-scripts --no-audit --no-fund` installed
its checked-in tsx 4.19.0 / zod 3.25.76 lock; temporary toolchain and canonical-runtime
links were used only to satisfy existing tests and removed before committing.
The earlier attempts failed on missing Node22/runtime and are superseded by the
successful recovery run. No test gate was weakened. `harness readiness` completed;
`harness tick` reported missing COORD_GATEWAY_URL (no gateway credentials/settings
were created), so no authoritative worker loop was registered in this environment.

## First safe merge plan (not performed)

1. Read latest main and PR HEAD again. Extract only this manual gate and its tests
   into a separately reviewed minimal change based on latest main. Do not merge
   the full release/OIDC draft to obtain token issuance or default-branch registration.
2. Read active/queued legacy prepare runs. Observed run 37786473841 on main was pending
   during this review. New YAML does not retroactively gate already-created runs.
   Any operator cancellation/approval decision is separate; none was made here.
3. Account for backend-gates main-push Devapp deployment: even a guard-only merge can
   trigger that existing automatic chain. Resolve explicit authorization for that
   effect before merging; do not silently disable/enable workflows.
4. Review the precise merge result, run gate simulations and required CI, then use
   a separately authorized merge. Immediately read the resulting default-branch
   YAML and new runs to confirm manual/main admission. Existing runs remain separate.
5. Keep #5512 Draft until actual HK ACR edition/target, GitHub OIDC RAM trust and
   resource grants, protected matching executor installation, three-database
   qualification, migration/recovery and public-browser business acceptance are
   independently satisfied. Then freeze a separately approved exact candidate
   containing matching control bytes; no old candidate equality bypass.

This recovery changes no IAM/network/credential configuration and performs no
workflow dispatch, upload, deployment, main merge or workflow enable/disable.
Provider 1177216024653153 and ECS i-uf6ga92ewloganobbln6 were not accessed or changed.
