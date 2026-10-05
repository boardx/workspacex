# Next execution

Continue PR #5245 in `/private/tmp/wsx-board-main-delivery-20261003`, branch `codex/board-main-delivery-20261003`. Do not merge, deploy or split.

User input pending: existing local Web/API, database/isolation ID, and configuration path for cross-tenant identity (no passwords/tokens in chat). Native toolchain path also required if already available. Formal producer creates a fresh private database and seeds identities, which does not satisfy the current requirement to reuse existing identities; resolve the authorized runtime wiring before executing. Do not relax toolchain, app_rw or exact-source gates.

After actual login/role proof, execute C06 single POST/response capture, Files verified bytes then tile, Sync lifecycle and primary failure diagnostics against exact source. Then run the complete signed suites through `apps/web/scripts/run-board-native-acceptance.mjs` only, using its CLI and strict receipts. Retain genuine failures.

Check `gh pr view 5245 --json headRefOid,statusCheckRollup`, verify remote head and all CI for that head. Current log/source hashes are in this folder. Re-run affected verification if runtime/test source changes.
