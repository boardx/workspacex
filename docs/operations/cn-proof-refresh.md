# Proof-only refresh and one-shot approval-directory exchange

Status: local proposal and offline canonical integration, no dispatch/cloud changes. Root will copy reviewed files into an isolated PR and wait for normal CI before any workflow dispatch. This refreshes proof for the exact original seven artifacts; it does not build images or refresh an old proof's timestamp by editing it.

## Runner

Copy `runner.py` to `scripts/cn-proof-only-refresh.py`, `workflow.yml` to `.github/workflows/refresh-cn-candidate-proof.yml`, and a newly reviewed plan to `.github/release-plans/proof-refresh.json`. `prepare-plan.py` constructs that plan from the independently pinned original acquisition request, with an explicit new issue/expiry window. The dispatcher supplies the exact plan SHA. The plan source is the original provider IDs, exact ZIP hashes/sizes, plan/set raw hashes and pinned producer verifier closure; it is not the expired proof or an HK receipt assertion.

The workflow allows only contents:read and actions:read, main and run_attempt=1. It has no OIDC, Alibaba credential action, HK upload or image build. On the Linux GitHub runner, unchanged canonical `--acquire` authenticates to GitHub and downloads all seven original ZIPs, then unchanged `--cached` checks metadata and full tar contents and produces a new proof/policy. One-day artifact upload includes exactly `small/proof.json`, `small/policy.json`, `small/receipt.json`. The receipt is non-authorizing. Mac may retrieve only these three small files; original ZIP/tar stay on GitHub runner and existing Shanghai inbox. Original HK nine objects are untouched.

The validator's 5GiB-per-ZIP/10GiB aggregate ceiling is the canonical acquisition protocol ceiling, not new authorization to build or exceed any earlier experiment's 2GiB limits. This plan binds actual already-built original artifact sizes; it does not use the old non-production trial authorization.

## Shanghai admission and approval swap

The installed publisher always reads `/etc/workspacex-cn/candidate-publish/SOURCE/ATTEMPT`. Merely putting a new proof elsewhere cannot refresh it. `swap-approval.py` is an independently reviewable one-shot proposal:

1. Assemble newly reviewed nine small refs/new approval with genuine fresh provider/tool/binary evidence. Do not edit historical metadata. New config binds `source`, `attempt`, a unique `generation`, every existing file under that approval directory (`oldTree`: raw SHA, bytes, mode), six incoming files (`newFiles`: base64, SHA), and the actual script SHA.
2. Fixed root config path `/etc/workspacex-cn/proof-refresh-approvals/<configSHA>.json`, private mode, and isolated Python entry. Root retains the canonical release lock throughout admission/copy/exchange.
3. Compare the entire old tree with the expected inventory. Preserve the old six original byte files in a new `.old-six-GENERATION` directory. Build a complete new sibling directory, copying canonical/node/source ordinary files without changing bytes/modes; replace only six metadata files. No hardlinks/symlinks or partial per-file edits to the live directory.
4. Before staging, verify installed tool pins and the original host approval validator; `rv.admit` binds the new proof to the exact original plan/set/artifact provenance. `cap.verify_bundle` reads **all existing Shanghai tar bytes**; `validate_intent` binds the new intent. No credentials are copied to ECS and no images are transferred by this step.
5. Fsync candidate and saved bytes, recheck both whole trees and approval time, and persist an exclusive exchange intent. Linux `renameat2(RENAME_EXCHANGE)` swaps the complete prepared and current directories. The old full tree then resides at `.history-GENERATION`. Preserve the journal and both trees if an outcome is unknown; never retry or automatically reverse it.
6. Mandatory next operation is the original installed publisher **--check-plan**, which performs real spool/Docker capacity and remaining canonical checks, followed by separately bound **--publish** only if check passes. Swap does not publish, load images or establish production readiness. Its copy-space guard is only staging space, not `SPOOL_CAPACITY` admission.

The config must contain an independently captured complete tree inventory; none is fabricated by these tools. Incoming metadata must come from the reviewed materializer; no production config is generated in this proposal. Persistent privilege or canonical entry changes are not introduced.

## Evidence and limits

Run `python3 -B -m unittest discover -s <this directory> -p 'test_*.py'`.

The integration uses synthetic original ZIP/tar bytes and a fake authenticated GitHub CLI, but runs the unchanged canonical acquisition and cached verifier in real subprocesses. The resulting proof is admitted and every tar is reverified; a changed tar fails. Other fixtures reject expired/invalid plans, old-tree drift, missing canonical admission, generation reuse and exchange uncertainty, and preserve original bytes.

Mac exchange fixtures use an explicitly injected three-rename substitute only to exercise transaction state and evidence. They **do not prove Linux atomicity**. The dedicated `ci.yml` job runs `linux-swap-test.py` on Ubuntu: real renameat2 exchange, cross-process lock, CAS, original tree retention, and response-loss reconciliation in disposable test-owned directories. This test exits nonzero outside Linux and is not a passing skip. Its actual CI result is required before execution; it has not run on this Mac. No real cloud refresh, ECS verification, directory exchange, or publisher call has been performed by this work.
