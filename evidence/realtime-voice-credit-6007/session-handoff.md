# Credit billing handoff

Implementation and independent source review are complete. Integration must finish on **develop**, as explicitly requested by the user. Main and production are outside this delivery.

Develop contains #6008 at 3bc34aa9ab562a1659e8143df95a0ba7620fa7c4 and #6009 at c6440c11e38153efac498117f76288b700ce1f66. External operations merged #6010/#6011/#6012 into feature branches while the verified batch push was running; that push correctly rejected moved refs. Recovered branches worker/credit-backfill-final → worker/credit-usage-final → worker/realtime-credit-final preserve the verified source without forcing remote history. Create only the next PR directly against develop after its predecessor actually lands, require pr-queue READY_TO_MERGE at the exact head, resolve actual findings and merge preserving ancestry. Current GitHub state takes precedence over this snapshot; the closed stacked PRs do not prove develop delivery.

The full implementation uses one wallet/period/receipt model. Monthly credits expire without touching purchased credit. Personal balance zero permits admission; negative refuses a new physical request; an admitted request can finish negative. Enterprise requests continue in debt. Billing unit is 1 credit / 1,000 tokens, accumulated and rounded up to 0.01 credit per physical request. Realtime voice uses trusted provider response usage across one admitted WebSocket.

Retained decisions and validation are in progress.md and the neighboring evidence. The previously ignored execution ledger was summarized there before cleanup. No historical feature status or signoff was changed. User skipped registry bootstrap; do not infer an enrolled agent identity.

Rollout requires a reviewed production inventory, resolving unsupported annual/trial/unverified records and applying the current-cycle backfill before enabling the new admission deployment. This session performed none of those production operations. Follow deploy/credit-subscription-migration.md; never substitute old paid invoices for an unpaid current cycle.

All owned isolated test stacks must be released by the isolation wrapper. Preserve the worktree until current-head CI and requested develop integration finish, then remove only this session's worktree after confirming clean tracked/untracked state. Other checkouts and processes are shared and must be left alone.
