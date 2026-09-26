# #4278 round 5 — a promoted personal decision is recalled in a new thread's unrelated turn (real browser, real local stack)

Done criterion under test (issue #4278): after 「我决定关注 211 高校」 is promoted to personal space, a **new**
personal thread's 「开始写报告吧」 turn carries the decision, labelled as coming from personal space.

## Stack (no Docker)

Same shape as round 3 (`evidence/phase-18/r03/`): local Postgres 16 + AGE + pgvector at 127.0.0.1:55432, own db
`r05e` (migrated from `apps/api` with `pnpm -s run migrate`), own `redis-server` on 58714, `apps/api` via
`tsx src/main.ts` (`KG_EXTRACTION_ENABLED=1`, extraction + projection workers in-process) on 58712, `apps/web`
via `next dev` on 58713 (same-origin proxy `/__fullstack_api`), Chromium from `/opt/pw-browsers`. Exact commands:
`harness/stack.sh.txt`. All of it was stopped and the `r05e` db dropped afterwards.

**Model: substitute, disclosed.** `apps/api/scripts/loopback-kg-eval-model-provider.ts` (the F15 KG-eval
loopback) fed the one-sentence corpus `harness/cases-r05.json`: extracting exactly 「我决定关注 211 高校」 returns
one `decision` claim because the corpus says so (it plays "an extraction model that read the sentence right").
Chat answers only echo the 【记忆】 block the executor actually handed the model that turn, so an answer that
contains the decision proves it was in the model's context. No real model was called. Everything downstream —
extraction worker, promotion, `PgKnowledgeRecall`, `fuseRecall`, `kg_turn_recalls`, the answer footer — is the
product path.

**Seed.** `scripts/seed-kg-experience-eval.ts` (it uses `seedOrg`, which since #4239 writes an `enabled=false`
org extraction row), then `harness/r05-post-seed.ts.txt`: **re-enabled extraction with `enableExtraction`** from
`tests/knowledge-graph/kg-extraction-fixtures.ts` (upsert `enabled=true`, `updated_by=test-fixture`; round 3
deleted the row instead), and added the owner as a member of the seeded project so a project thread can be opened.

## Steps

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | Personal thread P1: say 「我决定关注 211 高校」 → chip 「已记下：我决定关注 211 高校 · 撤销」, claim kind `decision` | PASS | `01-extracted-chip.png`, `journey.json` `step1_chip` / `ids.sourceClaim` |
| 2 | Memory panel → 「记到我的长期记忆」 → 「已记到长期记忆 1 条」; `/knowledge-graph/personal` lists it | PASS | `02-promoted.png`, `journey.json` `step2_personal` |
| 3 | **New** personal thread P2: say 「开始写报告吧」 → answer 「根据之前的对话：我决定关注 211 高校（来自个人空间知识，最早见于你 09/26 的对话）」; citation chip 「[1] 我决定关注 211 高校 · 来自你 9/26 的对话」; turn memory `scope=personal`, `channels=["claim"]`, `score=0` | PASS | `03-new-personal-thread-recalls.png`, `journey.json` `step3`, `db-proof.txt` (`kg_turn_recalls`) |
| 4 | *Observation, not a done criterion.* **New project thread**, same 「开始写报告吧」 → answer 「好的，收到。」, `recalled: []`, no `kg_turn_recalls` row; the personal claim is still live | current behaviour, recorded | `04-current-behaviour-project-thread-no-recall.png`, `journey.json` `step4`, `db-proof.txt` |

Step 4 is current behaviour only: the personal-space candidates reuse F12's L1 condition (requester's own
personal thread only). Whether a personal decision *should* follow the user into project threads is open
question (c) of the #4278 entry in
`phases/phase-18-org-brain-knowledge-graph/signoff-draft/chat-knowledge-graph/usecases.md`; this run does not
settle it.

## Files

- `journey.json` — ids, chip text, per-turn answer text / footer / `getTurnMemory.recalled`, personal space
- `db-proof.txt` — org extraction gate row, threads (`project_id`), claims (scope / revoked), `kg_turn_recalls`
- `harness/` — the Playwright spec + config (run from `apps/web` against the running stack; removed from the
  source tree after the run), corpus, post-seed script, stack commands, `playwright-run.txt` (4 passed)

## Notes

- The first run timed out in `newThread` because `next dev` exited mid-run (its `tsconfig.json` auto-edit was
  reverted underneath it); it was restarted and the full run passed. That aborted run left one empty 「新对话」
  personal thread (`thr-9aa78bdb…` in `db-proof.txt`); it has no messages and no effect on the steps.
- `next dev` compiles on first hit (/chat ≈ 130 s on this shared machine); pages were warmed with curl first.
