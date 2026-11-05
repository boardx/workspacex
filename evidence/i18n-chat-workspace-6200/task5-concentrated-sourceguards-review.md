# Chat6252 concentrated source-guard delta review

Verdict: STATIC CLEAN — no actionable P1/P2 in the requested three-file working delta against exact HEAD `94a10b14b69c4a771637fd9da75c501ccef551cc`.

Scope was independently checked with scoped git diff: only the three files below differ under apps/packages/.harness. No product implementation changed. This verdict binds the working-file hashes below rather than a future commit.

## Checks

- `chat-dead-mock-cluster.test.ts:163–171`: the exact importer ledger remains `toEqual`, now enumerating the two actual message-panel consumers (chat-read-screen and personal-chat-screen). Skill mount directly imports `describeMessageFailure` from `@/lib/live-chat` at source line 20; the message panel retains the exact re-export at line 1931. Both resolve the same exported function at live-chat.ts:755, with no duplicate helper implementation introduced by this delta. Two new literal provenance guards pin those import/export declarations. Route graph, dead-mock ledger, negative assertions and anti-empty-graph checks are unchanged.
- `gate-mutation-spec.ts:257`: only the declaration-file constant moves from controller/body to actual view. The existing view declares the exact marker at line 253. Gate command, guards, `replaceOnce` call, old/new marker literals, and mutation policy are unchanged. `replaceOnce` still returns false for absent file or absent original marker, rather than reporting a mutation that did not occur.
- `lint-e2e-testid-gate.test.ts:198`: only the same target path changes. The in-memory mutation still changes the original marker, requires the renamed marker to be present, and requires the gate to reject the original missing marker. No failure expectation or efficacy assertion was removed or loosened.

## Verification boundaries

Read-only source and git diff review only; no tests, lint, typecheck, browser, services, network, or source writes were performed by this reviewer. Parent subsequently reported fresh six-web-suite 96 PASS and two-harness-suite 57 PASS (including the previously RED mutation), plus web-ledger lint exit 0. These are author-reported results, not independently rerun here. The two .harness paths are ignored by canonical ESLint and remain **not linted**; no lint PASS is claimed for them. This limited static conclusion is not whole-branch or browser/CI acceptance.

## Frozen reviewed working files

- `apps/web/tests/session/chat-dead-mock-cluster.test.ts`: SHA256 `30af193686a76c2441c8015f698ff477337731738ce4bd2a3c33c36908f2d72f`, mode `644`.
- `.harness/scripts/lint-e2e-testid-gate.test.ts`: SHA256 `71bb5e0d7eb5b65c51fcdc21ef478933eb6c31e84564ac9ad4b5b65e60fcc327`, mode `644`.
- `.harness/scripts/lib/gate-mutation-spec.ts`: SHA256 `29a3c79719c830e5ab8892c16a7214d36f654f7431c0b6256a182767a5f22127`, mode `644`.
