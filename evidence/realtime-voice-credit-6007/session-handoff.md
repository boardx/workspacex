# Credit billing handoff

Implementation and independent source review are complete. Integration must finish on **develop**, as explicitly requested by the user. Main and production are outside this delivery.

Use the existing develop integration PR chain #6008 → #6009 → #6010 → #6011 → #6012. #6008 is merged at 3bc34aa9ab562a1659e8143df95a0ba7620fa7c4. For each remaining PR, retarget develop after the predecessor merges, mark ready, require the repository pr-queue classifier to report READY_TO_MERGE on the exact head, resolve actual review findings, then merge preserving ancestry. Never merge a child into its feature-branch base. Current GitHub state takes precedence over this snapshot.

The full implementation uses one wallet/period/receipt model. Monthly credits expire without touching purchased credit. Personal balance zero permits admission; negative refuses a new physical request; an admitted request can finish negative. Enterprise requests continue in debt. Billing unit is 1 credit / 1,000 tokens, accumulated and rounded up to 0.01 credit per physical request. Realtime voice uses trusted provider response usage across one admitted WebSocket.

Retained decisions and validation are in progress.md and the neighboring evidence. The previously ignored execution ledger was summarized there before cleanup. No historical feature status or signoff was changed. User skipped registry bootstrap; do not infer an enrolled agent identity.

Rollout requires a reviewed production inventory, resolving unsupported annual/trial/unverified records and applying the current-cycle backfill before enabling the new admission deployment. This session performed none of those production operations. Follow deploy/credit-subscription-migration.md; never substitute old paid invoices for an unpaid current cycle.

All owned isolated test stacks must be released by the isolation wrapper. Preserve the worktree until current-head CI and requested develop integration finish, then remove only this session's worktree after confirming clean tracked/untracked state. Other checkouts and processes are shared and must be left alone.
