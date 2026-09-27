# Round 9 — #4302: /brain accurately shows cross-session personal memory, real browser, real local stack

Branch `r09` (from origin/main `cfcfc27f1`). Human decisions (2026-09-26): live memories show 「来自你 {M/D} 的对话」 and
the tri-state badge; a superseded memory is folded under the one that superseded it (「取代了：…」); revoked
memories are not shown; /brain gets 「忘掉这条」 and 「撤销取代」, both reusing existing actions.

## Stack (no Docker)

Same shape as round 7: local Postgres 16 + AGE + pgvector at 127.0.0.1:55432, own db `r09e2e` (migrated, then
`scripts/seed-kg-experience-eval.ts` + `harness/r09-post-seed.ts.txt`, which re-enables extraction with the fixture
`enableExtraction`), own `redis-server` on 58915, `apps/api` via `tsx src/main.ts` (`KG_EXTRACTION_ENABLED=1`,
extraction and projection workers in-process) on 58912, `apps/web` via `next dev` on 58913 (same-origin proxy
`/__fullstack_api`), loopback model on 58914, Chromium from `/opt/pw-browsers`. Exact commands:
`harness/stack.sh.txt`. Everything was stopped afterwards, the `r09e2e` db dropped, and the temporary spec/config
removed from `apps/web` (copies in `harness/`).

**Model: a stand-in, disclosed.** No real model was called. `apps/api/scripts/loopback-kg-eval-model-provider.ts`
(the F15 KG-eval loopback) runs **unmodified** (no patch was needed this round) and reads `harness/cases-r09.json`:
「我决定关注 211 高校」 and 「改成关注 985 高校吧」 each extract one `decision`. Everything downstream is the product path:
the extraction worker, #4290 supersede detection (「改成关注 985 高校」 vs 「我决定关注 211 高校」 is `same_kind` ⇒
automatic), #4283 auto personal copy, the read paths, the /brain UI and its two write actions.

## Steps — `harness/playwright-run.txt`: 5 passed

| # | Step | Result | Evidence |
|---|------|--------|----------|
| setup | Owner, personal thread A: 「我决定关注 211 高校」; new personal thread B: 「改成关注 985 高校吧」. `/knowledge-graph/personal` ends with live `[改成关注 985 高校]` and `replaced` = 211 under 985 with `undo.threadId` = B. | PASS | `journey.json` `afterChange` |
| 1 | `/brain`: one item 「改成关注 985 高校」, badge 「AI 记下的」, 「来自你 9/27 的对话」 (browser-local date of `saidAt`), folded line 「取代了：我决定关注 211 高校」 with 「撤销取代」, and 「忘掉这条」. | PASS | `1-brain-985-folded-211.png`, `s1` |
| 2 | Click 「撤销取代」 → `POST /knowledge-graph/threads/<B>/actions {basedOnRevision, undoSupersede, noticeId}` 200; both 211 and 985 listed, no folded line. | PASS | `2-after-undo-supersede-both.png`, `s2_request`, `s2` |
| 3 | Click 「忘掉这条」 on 985 (pending + auto-copied ⇒ `undoAutoPersonalCopy`) → 200 `revoked`; 985 gone, still gone after a reload; thread B's own claim is untouched. | PASS | `3a-after-forget-985.png`, `3b-after-reload.png`, `s3*` |
| privacy | Another member of the same org: `/knowledge-graph/personal` empty (`claims: []`, `replaced: []`), /brain shows the empty state. | PASS | `4-other-member-empty.png`, `privacy` |

`db-proof.txt` (`harness/db-proof.sql`): the notice is `undone` by the owner; the personal 211 is live again
(`proposed`, derived_from edge active again); the personal 985 is `superseded/user_revoked` (the forget), its
session claim in B is still live; the audit has `undoSupersede` (session + personal) and `undoAutoCopy`, all human.

## Fail-without-fix

- `fail-without-fix-api.txt`: `apps/api/src/infrastructure/knowledge-graph/pg-knowledge-read.ts` reverted to main
  (contracts kept) ⇒ `brain-personal-history.test.ts` 6/6 and the F16 personal keep_new test fail (`replaced`,
  `saidAt`, `autoCopied` missing).
- `fail-without-fix-web.txt`: `apps/web/components/brain/personal-memory.tsx` reverted to main ⇒ all 8 new
  `brain-screen.test.tsx` cases fail (time, folded line, undo-supersede, both forget mappings, both rollbacks, copy).
