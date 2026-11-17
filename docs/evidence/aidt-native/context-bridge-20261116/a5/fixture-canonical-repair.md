# Isolated stack04 fixture instruction repair

This is explicitly authorized private QA data preparation, **not** ordinary Agent publishing API acceptance.
The existing seeded default Agent has null authoring state/definition fields, so the ordinary self-publish
repository rejects it. No authoring fields, permissions, model configuration or product contract were changed.

The original S2 failure and echo-instructed run are preserved. Root reviewed the append-only fixture path;
a separate plan added Chat-message protection and retained the original plan file/hash. The new plan's 15
protected groups matched A1's independent before-with-chat snapshot exactly. One apply then committed using
`PgDatabase(appConfig()).withTenant`, the existing immutable-version insertion helper with old-version role
source, an Agent row lock and an expected-old-version pointer compare-and-set.

- Reviewed plan hash: `93d2404e6e55d0b8e06bdffbc887f8adf7aee145702a3297a12e92d19e00afe4`.
- Old version: `agent-fullstack-yr-c7e722d0-fc9ebf5fdbbe-v1` (unchanged).
- New fixture version: `agent-version-fixture-428d072b-cf41-465b-86f7-6b02fe39136f`.
- Old instruction digest: `49b0f07ba859d6b961a5317893450eaedaf9062ae593cf0278a41e5ed3408726`.
- New canonical digest: `802cf79cc20cd6861c2aa766d7a7c4b1a9094add3624f523e467dd81c85fe371`; bytes imported from `DEFAULT_AGENT_INSTRUCTIONS`.
- Model/provider, Skill pins, tool policy and role fields copied from the old version.
- Old versions, runs, snapshots, Chat human/AI text, memberships/ACL/listings, financial rows and the two
  budget ledger hashes were unchanged in the transaction's after-check; only one new version and the
  existing Agent's published-version pointer changed. The old pointer is retained in both plans/receipt.
- Executor verification used A1's actual closed launch record, matching current PID/startTicks, health and
  tenant DB zero-active/zero-unsettled/zero-hold checks. OS denied direct `/proc/.../environ` and cwd reads;
  these were **not** represented as successful direct inspection.
- `normalPublishApiVerified=false`; repair model requests: **0**. This does not reopen paid windows,
  repair the old run retroactively or establish teaching/model quality.

Sources: [original plan](fixture-canonical-original-plan.json), [reviewed plan](fixture-canonical-reviewed-plan.json),
[application receipt](fixture-canonical-application.json). A1's independent committed-state after check
also exited 0: [independent after](../../completion-20261116/a1/context-stack04-fixture-after-independent.json).
It confirmed the complete old-v1 hash, all 15 protected groups (including six Chat messages), both budgets,
exact canonical instruction bytes/digest, unchanged remaining version fields, two total versions, and the
new published pointer. Replacing that pointer with the recorded old ID restored the complete old Agent
row hash. No model request was made by either repair or independent check.
The script and 13 pure guards/call-recording tests live in `scripts/aidt-default-fixture-repair.mjs`,
`scripts/lib/aidt-default-fixture-repair.mjs`, and `scripts/tests/aidt-default-fixture-repair.test.mjs`.
The 13 passing offline tests are not PostgreSQL authorization evidence; the actual plan/application used
this isolated stack's tenant `app_rw` identity. Future paid AIDT stacks select the directly imported canonical
instructions through an explicit fixture profile; unspecified ordinary loopback fixtures retain exact echo behavior.
