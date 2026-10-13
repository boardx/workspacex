# Local provider → evidence → report replay

Run from a checkout with installed dependencies and the historical commit available:

```sh
node docs/evidence/research-organizing-5546/local-runtime-replay/replay.mjs
```

The command snapshots exact pre-fix `4d407d2ff1df62abd6b6429395ccb3115b36ca4d` and current `HEAD` API/workspace package sources into a private temporary directory. Production imports are absolute and contracts resolve to each snapshot. It reuses installed external dependencies and the same controlled geometry fixture. It creates no Git worktree and removes its snapshots after execution.

For both first generation and regeneration, the old source must fail its successful-report assertion with `RESEARCH_WORKFLOW_UNAVAILABLE` after batch 15 returns HTTP 400 with exact `error.code=data_inspection_failed`. Current source must produce four formal sections and 32 question evidence entries, with no draft/quality warnings and the previous report preserved. Rejected batch 15 is requested once. Invalid evidence quotes also preserve successful generation; unclassified HTTP 400 and authentication HTTP 401 remain fatal without a new formal report, preserving the previous version.

Exit 0 means the expected old red and all eight current scenarios were observed. The JSON includes exact commits and hashes of the actual executed scenario files; loader failures cannot count as expected red.

Limits: this uses loopback HTTP, synthetic text matching the original 23-batch geometry, fixed semantic review verdicts, and an in-memory clone store. It tests adapter classification, evidence isolation and report orchestration/save calls. It does not validate real-model quality, database durability, original online error classification, deployment, or online recovery. “Invalid-reference” is an evidence-extraction quote, not a malformed prose citation. No credentials, original research text, or external models are used.

The production content-rejection fix is already on main through PR #5587. This evidence does not duplicate that implementation or the separate first-frame identity fix #5598. Refs #5546.
