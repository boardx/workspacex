# #6107 capacity worker handoff

## Verified

Worker tree `/Users/shenyangjun/boardx/workspacex/.worktrees/team-capacity-6107`, branch `worker/team-capacity-6107`; reuse it, never create another tree. Node 22.23.2 requires `PATH=/Users/shenyangjun/.nvm/versions/node/v22.23.2/bin:$PATH`. Bootstrap quick init exited 0; pure capacity tests six passed. Original three real PG business counterexamples red at `2c3b48730`, same assertions green after member-entry patch (5.23s). Logs are committed beside this file. This does not verify later additions or P2 fix.

## Changes and state

Current source baseline before this documentation commit: `b0542a6a212f76723626215584041c1e098d9e11`; clean committed tree. Main source implementation `5619e25e0`; approved pending-intent restrictive DELETE policy/helper added in `1dcae6e1f`. API/member entrance ownership remains this worker; wallets, finance SQL generators, BillingModule, billing-team.ts belong to root; Plan/Enterprise implementation belongs to sibling.

Known P2 is intentionally still present in source to run its real red counterexample. Prepared exact patch is `revocation-fix.patch`, statically ACCEPTed at artifact SHA `f7121e1360d136285be987b45e28877a93c7d5a4`. It orders epoch shared → unlocked token lookup → organization → pending invite FOR UPDATE → conditional token consumption → capacity/credential → conditional used update. This matches resend's invite → token order; do not merely add an invite lock after consuming token.

PG file now has eight cases: invitation non-reservation, cross-connection last seat, new-account project rollback, unpaid expansion, initial pending/unknown generation, controlled revoke race, paid/cross-tenant/wrong-reference pending deletion, logged-in project rejection. Dedicated HTTP file has two real Kernel cases including four org roles and forged query claims. New tests restore epoch snapshot and clean their own UUID-scoped credentials/gifts/outbox. None of these later cases/HTTP has been executed yet.

## Unverified / external dependency

No PR or remote branch push yet. origin/develop last read was `b3e9977de`; signed design dependency `8e07cd7d82c6491f3d8a91431f0f8ca805ec4257` was explicitly merged locally and still needs normal integration into develop before independent business PR scope. Fetch main/develop before continuing; inspect live ancestry rather than trusting this snapshot.

Full API typecheck was deliberately terminated during resource contention, not passing. Root owns static scheduling; pre-push triggers broad turbo typecheck/lint relative to main. Do not bypass CI or merge. No passing state was written; Team sales remain gated.

Latest parent scheduling signal: Enterprise admission stopped at 414s/perCore14+, no stack; parent prioritized another owner's static hook and requires an explicit new resource release before resuming. Order when released is Enterprise final schema/HTTP, then this worker P2 red/green/HTTP/permission regressions. Read fresh messages; this paragraph is not a live resource signal. This worker has no queue, test process, or owned compose stack left. Last owned stack `wsx-be57b584690acd41508a` was removed.

## Next concrete actions

1. Wait for root's explicit fresh PG window; do not start an admission queue before it. Reuse this tree. Fetch origin main/develop; avoid changing sources while the red process runs.
2. In ONE `with-test-isolation.ts` wrapper run `pnpm --filter api exec vitest run tests/org-capacity/commercial-capacity-pg.test.ts -t 'revocation committed'`. Inspect that the failure is the actual stale-invite grant, not a fixture/import failure. Record exact HEAD and output.
3. Still in that owned wrapper, apply `git apply evidence/org-capacity-6107/revocation-fix.patch`; independently run full `tests/org-capacity/commercial-capacity-pg.test.ts`, then `tests/org-capacity/commercial-capacity-http.test.ts`. Keep assertions identical; diagnose any failures rather than blind reruns.
4. Run existing scoped regressions serially after cold migration is already complete: `tests/auth/admin-invite-dual-review.test.ts`, `tests/org-admin/set-org-member-role-real.test.ts`, `tests/auth/quota-exhausted-hard-block.test.ts`. Root may coordinate another precise selection. Release wrapper immediately after results, confirm owned containers gone, notify root/Enterprise.
5. Commit applied fix + exact logs, update #6107 and this evidence boundary. Ask root to arrange final exact-SHA security/feature review and actual browser evidence. Only create independent Closes #6107 PR targeting develop after design dependency is integrated; normal CI must be green. Worker never merges or deploys.
