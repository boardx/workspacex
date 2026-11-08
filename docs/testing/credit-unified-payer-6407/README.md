# Unified Credit payer — issue #6407

Enterprise member allowance is checked before each new physical request. If it cannot cover that request, personal Credit must cover the entire request. Non-enterprise organizations use personal Credit directly. Insufficient personal capacity refuses dispatch; it never grants unmetered execution. Existing requests keep their admitted payer, including receipts after membership, plan, or calendar changes.

Unknown-cost requests reserve the remaining personal spending capacity until an authoritative receipt releases it. This is a conservative capacity reservation, not measured usage or a debit. It can temporarily prevent another request using the same personal wallet across organizations. Unknown outcomes keep their reservation; elapsed time does not prove zero consumption.

The existing gross wallet hold must keep its meaning for old writers. Personal admission needs the unconsumed part of outstanding holds because partial receipts already reduce balance. The implementation uses an additive wallet projection maintained by database request changes; it does not transfer incurred team charges to personal Credit or rewrite historical consumption.

The runtime persists only allowlisted Credit codes, optional monthly-limit reason, and server-derived payer identity. SSE and polling expose the same projection after restart. Payer identity is checked against an auxiliary operation before constructing its recharge guidance. Provider text, arbitrary URLs, balances, prompts, and original exception messages cannot trigger recharge. Legacy class-only errors remain unclassified.

No production deployment, payment, allowance edit, or production migration is part of this change. Repository tests do not establish China production acceptance.

```mermaid
flowchart TD
  G([Unified Credit payer])
  S1[Confirm canonical admission and invariants]
  S2[Implement payer and compatible hold projection]
  S3[Preserve typed runtime and audio failures]
  S4[Run real PostgreSQL and transport regressions]
  S5[Independent review and green PR]
  G --> S1 --> S2 --> S3 --> S4 --> S5
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 tested
  %% evidence S1: Canonical reserveInSession and fixed receipt payer verified
  class S2 tested
  %% evidence S2: Final isolated payer/concurrency matrix: 15 passed
  class S3 tested
  %% evidence S3: Typed runtime/audio, policy-stop finalization and UI verification passed
  class S4 tested
  %% evidence S4: Final API TypeScript and reviewed lint exit 0; runtime53, PG authority15 and integrated WS verified
  class S5 todo
```

## Migration and maintenance boundary

`20261108120000_credit_remaining_holds.sql` takes wallet and request table locks with `NOWAIT` inside the normal atomic migration transaction. If activity conflicts, the transaction must roll back and the release must retry later; never kill sessions or remove the lock guard to force it through. The migration backfills only the new projection and installs an invoker trigger. It neither changes balances nor the existing gross hold. Old receipt writers continue to maintain the new projection through the trigger after the migration commits. Rolling back application code stops reading the new projection; leave the additive column and trigger in place.

Business admission and receipt paths acquire the organization financial lock and wallet row lock before request changes. Owner maintenance or repair SQL must also lock affected wallets in deterministic order before updating or deleting requests, then perform all related accounting changes in the same transaction. Runtime retains its existing lack of request DELETE permission. Arbitrary request-first SQL is not promised to be deadlock free: PostgreSQL may abort and roll back one transaction, which the operator must inspect and retry safely. Never replay a model call to repair accounting.

## Validation evidence

- Runtime regression: `pytest tests/test_self_hosted_runtime.py tests/test_standard_audio_tools.py`: 29 passed. Before implementation, typed polling failures were 3 failing cases and typed audio failures were 2 failing cases.
- API Credit runtime suite: 44 passed before adding two SSE refusal cases; the SSE-specific suite then passed 6 cases. Scope includes actual payer validation against the auxiliary operation and generic provider text remaining generic.
- Credit UI regressions: 26 passed, including scoped recharge, ownerless legacy account review, draft retention, and accounting-unavailable without a recharge action.
- API TypeScript check passed before payer integration; final integration checks remain pending.
- Candidate isolated PostgreSQL matrix: 11 passed before integration. This is not a substitute for existing billing regression or final CI.

## Final integration and review

Personal continuation checks spending capacity after the receipt commits, excluding the current request's own remaining hold from other holds. A confirmed personal-policy stop preserves reported counters; a receipt write failure, including a `null` rejection, remains unknown. Live organization writability and membership are checked before further use; revocation never prevents settling incurred charges. Concurrent revocation does not retroactively cancel an already dispatched response.

Independent coordinator security review binds `member-credit-quota.ts` to Git blob `28771013e1df7dd6af91ec004d26de99d98bb08f`. The financial drift snapshot is regenerated with the existing official tool after review. No new database privilege, definer function, or runtime request-delete permission is introduced.

Latest evidence:

- Integrated PostgreSQL and actual WebSocket run: 21 ordinary cases and 30 required serial cases passed, including next-session personal fallback after Enterprise quota exhaustion while the prior team charge stays fixed.
- Final payer/concurrency/live-authority matrix: 15 passed. Clean old-function organization counterexample incorrectly resolves continuation instead of rejecting. Initial parameterized fixture collision is documented separately and is not counted as a security counterexample.
- Continuation focused matrix: old function 2 failed, new function 2 passed through standard isolation. Unknown outcomes retain capacity; authoritative reconciliation releases it.
- Finalization counterexamples: 2 failed before the fix; final focused unit suite 7 passed, including `null` receipt rejection remaining unknown.
- Full billing discovery run earlier: 109 files, 820 passed / 36 failed / 3 skipped, plus a failed fixture setup. This is retained as a diagnostic run, not a passing claim. Rule-conflicting expectations were updated with explicit Enterprise or funded personal fixtures. Independent baseline historical replay and global catalog pollution repairs are tracked in PR #6413 and issue #6414.
- Normal mixed-version compatibility preserves old gross accounting and maintains the additive projection. Old admission code still follows its old product policy until all instances run the new code; the new strict admission guarantee applies to the updated entry point.
