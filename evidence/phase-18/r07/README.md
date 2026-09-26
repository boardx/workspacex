# Round 7 — #4283 (decisions auto-recorded in the author's own personal space) and #4284 (personal memory in project threads, self-only), real browser, real local stack

Branch `r07` = #4283 + #4284 + origin/main + round 3, plus the round-7 fix that closes the extraction leak #4284
left open (a project-thread answer that used the requester's personal memory is not extracted into shared project
knowledge).

## Stack (no Docker)

Same shape as rounds 3 and 5: local Postgres 16 + AGE + pgvector at 127.0.0.1:55432, own db `r07`, own
`redis-server` on 58744, `apps/api` via `tsx src/main.ts` (`KG_EXTRACTION_ENABLED=1`; extraction and projection
workers in-process) on 58742, `apps/web` via `next dev` on 58743 (same-origin proxy `/__fullstack_api`), Chromium
from `/opt/pw-browsers`. Exact commands: `harness/stack.sh.txt`. Everything was stopped and the `r07` db dropped
afterwards.

**Model: a stand-in, disclosed.** No real model was called. `apps/api/scripts/loopback-kg-eval-model-provider.ts`
(the F15 KG-eval loopback) reads the corpus `harness/cases-r07.json`:
- Extraction of an exact sentence returns what the corpus says. The loopback plays "an extraction model that read
  this sentence right": 「我决定关注 211 高校」 and 「我决定关注 985 高校」 each become one `decision` claim.
- Chat answers only echo the 【记忆】 block that the executor actually handed the model that turn. An answer that
  contains a decision therefore proves the decision was in the model's context.
- **New in this round, opt-in:** `LOOPBACK_KG_EVAL_EXTRACT_ASSISTANT=1` makes the loopback also match assistant
  messages (「本条消息（助手说的）」) against the corpus. The default is off, so the F15 eval is unchanged. The corpus maps
  the exact answer text 「根据之前的对话：我决定关注 985 高校（来自个人空间知识，最早见于你 09/26 的对话）。」 to one fact
  claim 「关注名单已经定下来了」. So if that answer were extracted, a claim WOULD appear. Step 4284-2 shows this
  happening in a personal thread.

Everything downstream is the product path: the extraction worker, #4283 auto personal copy and undo,
`PgKnowledgeRecall`, `fuseRecall`, `kg_turn_recalls`, the extraction gate, the read paths and the UI.

**Seed.** `scripts/seed-kg-experience-eval.ts`, then `harness/r07-post-seed.ts.txt`. The post-seed re-enables
extraction with the fixture `enableExtraction` (`seedOrg` writes `enabled=false` since #4239). It also makes owner,
newbie and other project facilitators.

**One deviation, disclosed.** The v2 「新对话」 button inside a project creates a `private` thread
(`lib/chat-workbench/project-scope.ts`). Only its creator can read a private thread, so a second member could never
open it. On the first attempt B got 404. So A's shared project thread was created with A's own session through the
product endpoint `POST /chat/threads/mutate` (`visibilityScope: "plenary"`). This is the same call the project
thread-list create form makes (`chat-read-screen.tsx` `handleCreate`). Both accounts then used it in the v2 chat UI
at `/chat/<id>?projectId=…`.

## Steps — `harness/playwright-run.txt`: 8 passed

| # | Step | Result | Evidence |
|---|------|--------|----------|
| 4283-1 | Owner, personal thread A: 「我决定关注 211 高校」. The chip reads 「已记下：我决定关注 211 高校 · 已记入个人记忆 · 撤销」. `/knowledge-graph/personal` lists the copy. No promote was clicked. | PASS | `4283-1-chip-auto-personal.png`, `journey.json` `s4283_1*` |
| 4283-2 | New thread B: 「开始写报告吧」. Answer: 「根据之前的对话：我决定关注 211 高校（来自个人空间知识…）」. The citation chip shows it. Turn memory `scope=personal`, `channels=["claim"]`. | PASS | `4283-2-thread-B-recalls.png`, `s4283_2` |
| 4283-3 | Back in thread A's tab: 「撤销」 on the chip. The chip line goes away and the personal copy leaves `/knowledge-graph/personal`. | PASS | `4283-3a-before-undo.png`, `4283-3b-after-undo.png`, `s4283_3` |
| 4283-4 | New thread C: 「开始写报告吧」. Answer: 「好的，收到。」, `recalled: []`. | PASS | `4283-4-thread-C-no-recall.png`, `s4283_4` |
| 4284-1 | A (newbie), personal thread: 「我决定关注 985 高校」. The chip shows 「已记入个人记忆」. | PASS | `4284-1-A-personal-decision.png` |
| 4284-2 | *Control (non-vacuity).* A, a new **personal** thread: 「开始写报告吧」. The answer text is exactly the corpus text, and extraction produces 「关注名单已经定下来了」 in that thread. | PASS | `4284-2-control-personal-answer-extracted.png`, `s4284_2*`, `db-proof.txt` (`claims_from_it = 1`) |
| 4284-3 | A, shared project thread: 「开始写报告吧」. A's answer uses A's personal decision, the answer text is identical to 4284-2, and A's own citation chip shows it (`scope=personal`). | PASS | `4284-3-A-project-answer.png`, `s4284_3` |
| 4284-4 | B (other) opens the same thread 12 s later. Citation chips: none. `getTurnMemory.recalled`: `[]`. Extraction feedback for A's answer: `[]`. Knowledge panel (API and UI, 「记忆（0）」): nothing, for both A and B. Source drawer for A's personal claim and for its source claim: 404, identical to a nonexistent id. The project gains no claim from A's answer. | PASS | `4284-4a-B-views-A-turn.png`, `4284-4b-B-knowledge-panel.png`, `s4284_4`, `db-proof.txt` |

In `db-proof.txt`, the project answer `be71c39f…` has `queued = 0` and `claims_from_it = 0`, and the API log has
`kg extraction skipped: project-thread answer used personal memory … outsideRecallItems: 1` for it. The control
answer `5d236b9d…` has the same body in a personal thread and has `claims_from_it = 1`.

**The one remaining trade-off, as documented in `usecases.md`.** B can read the **answer text** in 4284-4a, and it
paraphrases A's personal decision. This is the answer's own visibility. The structured memory paths and the
extraction path no longer carry it.

## Files

- `journey.json`: ids, chip text, per-turn answer text, footer and recall, B's view of every read path.
- `db-proof.txt`: gate row, threads, claims (scope, kind, status, revoked), `derived_from` edges, evidence with the
  author kind, `kg_turn_recalls`, agent answers with their queue and claim counts, and the API gate log line.
- `harness/`: spec, config, corpus, post-seed, stack commands, the proof SQL and the Playwright output. The spec
  and config were run from `apps/web` and removed from the source tree after the run.

## Notes

- On the first run, 4283-3 failed because the extraction chip exists only on messages sent in the current tab
  (`sentThisSession`); a history reload shows the answer's own 「已记下 1 条 · 撤销」 line instead. The spec now opens
  threads B and C in a second tab of the same session, so thread A's chip is still there for the undo.
- A second run failed at 4284-2 before the loopback could match assistant messages; that is what led to the opt-in
  flag above.
- The db was reseeded between runs. `api.log` also holds a gate line from an earlier attempt (a `private` project
  thread); `db-proof.txt` quotes only this run's line.
