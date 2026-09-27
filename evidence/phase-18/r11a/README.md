# Round r11a — #4343: goal / preference memory kinds, real browser, real local stack

Branch `r11a` (from origin/main `8270388ae`). Bug: in a personal thread 「我的目标是探索未来教育」 produced 0 memories
while the panel said 「已整理到最新」 — the closed claim-kind enum and the extraction prompt had no goal / preference,
the model returned nothing and `extractJob` finished as "empty" without a log line. Human decision (2026-09-27): add
the kind.

Design (see the code comments for the why): two kinds `goal` (目标) and `preference` (偏好); prompt asks for the
user's *own* first-person goals / intentions / preferences (questions, requests, hypotheticals, others' goals
excluded; `about` may be empty); `kg-extract@2`; own goals / preferences auto-copy into the speaker's personal space
through the #4283 path (personal threads only, `selfIntentLike` = kind + first-person / non-question /
non-hypothetical gate); forced recall every turn with a separate budget `SELF_INTENT_RECALL_LIMIT = 3`; #4290
supersede stays decision-only; the empty outcome is logged (`kg extraction empty`, with messageId + reason) and
counted (`tick.empty`, per-tick `kg extraction tick` summary).

## Stack (no Docker)

Same shape as round 9: local Postgres 16 + AGE + pgvector at 127.0.0.1:55432, own db `r11ae2e` (migrated, then
`scripts/seed-kg-experience-eval.ts` + `harness/r11a-post-seed.ts.txt`), own `redis-server` on 59115, `apps/api` via
`tsx src/main.ts` (extraction and projection workers in-process) on 59113, `apps/web` via `next dev` on 29114
(59114 is inside the kernel ephemeral range and was taken by an outbound socket), loopback model on 59112, Chromium
from `/opt/pw-browsers`. Exact commands: `harness/stack.sh.txt` + `harness/env.sh.txt`. Everything was stopped
afterwards, `r11ae2e` dropped, the temporary spec/config removed from `apps/web` (copies in `harness/`) and the
`tsconfig.json` include that `next dev` adds was reverted.

**Model: a stand-in, disclosed.** No real model was called. `apps/api/scripts/loopback-kg-eval-model-provider.ts`
runs **unmodified** and reads `harness/cases-r11a.json` (passed by `LOOPBACK_KG_EVAL_CASES`, the frozen eval corpus
is untouched): 「我的目标是探索未来教育」 extracts one `goal`. Everything downstream is the product path.
Rubric hash before and after: `3796053d1d1bd05dac14433e4beea45317befd46717bce7b284596de946733b1`.

## Steps — `harness/playwright-run.txt`: 4 passed

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 1 | Personal thread: 「我的目标是探索未来教育」 → under the message 「已记下目标：我的目标是探索未来教育 · 已记入个人记忆 · 撤销」; the thread's only claim is `goal`; the memory panel shows group 「目标 1」 with the item; `/knowledge-graph/personal` = one `goal`, 「AI 记下的」. | PASS | `1a-chip-goal-recorded.png`, `1b-panel-goal-group.png`, `journey.json` `s1_*` |
| 2 | New personal thread: 「帮我规划一下」 → answer 「根据之前的对话：我的目标是探索未来教育（来自个人空间知识，…）。」; citation chip `[1] 目标 我的目标是探索未来教育 · AI 记下的 · 来自你 9/27 的对话`; turn memory `kind=goal, scope=personal, channels=["claim"]` (forced recall). | PASS | `2-new-thread-plan-uses-goal.png`, `s2_*` |
| 3 | `/brain`: group 「目标 · 1」 with the item, kind filter 「目标 1」. | PASS | `3-brain-goal.png`, `s3_group` |
| privacy | Another member of the same org: personal space has no goal, /brain empty state. | PASS | `4-other-member-empty.png`, `privacy` |

`db-proof.txt` (`harness/db-proof.sql`): session `goal` + personal `goal` copy (proposed, created_by model), an active
`derived_from` edge personal → session, audit `extract` at `kg-extract@2` and the system auto-copy, and the one turn
recall row on the `claim` channel. `api-extraction-log.txt`: the new `kg extraction empty` lines (messageId, reason,
pipelineVersion) and `kg extraction tick` counts (`written` / `empty` / `skipped` / `failed`).

## Fail-without-fix

- `fail-without-fix-api.txt`: each file reverted to origin/main in turn — `auto-copy-decisions.ts` (4 new
  integration tests fail: no personal copy, no recall, nothing to undo), `recall.ts` (2 integration + 2 unit recall
  tests), `extract-message-knowledge.ts` (the empty-log / `tick.empty` test), `model-knowledge-extractor.ts` (prompt
  test); and a fresh db without migration `20260927110000` (5 integration tests: the CHECK rejects `goal`). All
  restored: 29/29.
- `fail-without-fix-web.txt`: `extraction-feedback-chip.tsx` (4), `answer-knowledge-footer.tsx` (1),
  `knowledge-graph-view.ts` + `brain-view.ts` (6) reverted ⇒ the new label / group / order tests fail; restored 81/81.
