# #4290 round 8 — an explicit change of mind supersedes your earlier decision, undoably (real browser, real local stack)

Done criteria under test (issue #4290, human decisions 2026-09-26): personal thread A 「我决定关注 211 高校」, thread B
「改成关注 985 吧」 → the 211 decision is superseded automatically and B's answer shows 「已用〈新〉取代〈旧〉 · 撤销」;
thread C 「开始写报告吧」 → the answer carries only 985; undo → 211 is live again.

> **Rule change after this run (human decision 2026-09-26, "高把握自动、低把握弹卡").** This browser run used the
> earlier **all-automatic** rule. Since then only the high-confidence tiers (`explicit`, `same_kind`) supersede
> automatically; the low-confidence `frame_only` tier never does — it opens an F16 card
> (`KgConflictPrompt.kind = possible_change`, 「用〈新〉取代〈旧〉？」 [取代] / [两条都保留]) and both decisions stay live
> and recalled until the user chooses. The run still matches the new rule: the substitute model normalised B's claim to
> 「改成关注 985 高校」, which is `same_kind` against 「我决定关注 211 高校」, so it still supersedes automatically. The browser
> run was **not** re-done for the card path; that path is covered by
> `apps/api/tests/knowledge-graph/decision-supersede-card.test.ts` (real app + DB: card, both recalled while pending,
> [取代], [两条都保留], privacy, negatives) and `apps/web/tests/ui/kg-conflict-card.test.tsx` (the card variant).

> **Tightened again (review round 4 of round 8): automatic only for a clean sentence.** A wrong automatic supersede is
> the one outcome we must not produce; a spare card is cheap. Automatic now means: the change clause, plus other clauses
> that are only whole-clause filler (好的 / 嗯 / 那就这样 / 定了 …, a small closed list), another change clause naming
> the same new object, or a reason clause (因为 / 由于 / 毕竟); plus either an explicitly named old object (`explicit`) or
> an **aligned** `same_kind` (both specifiers in front of the shared category word are short — at most 4 characters or one
> ASCII token, no frame / action verb: 211 / 985 高校 yes, React做前端开发 / Rust做后端开发 no). Everything else is a card
> (an unrecognised trailing clause such as 「这是老板说的」, another clause mentioning the old object such as
> 「211高校继续关注」, an unaligned same kind) or nothing (a trailing verdict such as 「我反对」「不可行」, a
> self-correction 「不对，还是211高校」, 「开玩笑的」, 「把Vue换成React的事…」). This run's sentence 「改成关注 985 高校」 is a
> single clean clause and aligned `same_kind`, so it is still automatic. Tests: the round-4 `describe` block in
> `decision-supersede.test.ts` and the 「改成关注985高校，我反对」 case in `decision-supersede-recall.test.ts`; the old domain
> file fails 27 of them (`fail-without-fix.txt`, last section).

> **Tightened again (review round 5 of round 8): reason clauses, tag questions, compound old decisions.**
> - *Reason clauses.* 因为 / 由于 / 毕竟 are all stripped the same way before the verdict check, so 「，毕竟我反对」
>   「，由于老板不同意」 are rejections (no supersede, no card). A reason clause stays on the automatic path only if its
>   content has no negation or uncertainty character or word (不 / 没 / 否 / 未 / 非 / 还没 / 假设 / 暂 / 可能 / 也许 / 先 /
>   反对 / 拒绝 / 驳回 / 或许 / 大概 / 说不定 / 万一 / 如果 / 要是); otherwise it is a card (「由于我不同意这个改动」
>   「由于还没最终确定」「由于是假设」「毕竟不急」). 「因为离家近」「毕竟生态好」 stay automatic.
> - *Tag questions.* 对 / 是 / 行 are no longer whole-clause filler. 「，对吧」「，是吧」「，是不是」「，对不对」「，好吗」
>   (or 对吧 / 是吧 at the very end) make the sentence a question: nothing. 「，行吧」「，好吧」「，好的吧」 (reluctant) are a card;
>   so is 「，是的」.
> - *Compound old decisions.* An old decision with more than one clause carrying a frame verb (「后端用Go语言，前端用TS语言」)
>   or a coordinated subject in front of its frame verb (和 / 与 / 及 / 跟 / 都, or 「、」 anywhere: 「前端和后端都用Vue框架」)
>   is never superseded automatically — at most a card, because an automatic supersede retires the whole statement,
>   including the part nobody changed. A change clause with a subject must find that subject in front of the frame verb
>   in the old frame's own clause; found only elsewhere in the old decision ⇒ card; not found at all ⇒ nothing
>   (「把 X 换成…」: the subject is the named old object, checked by the `explicit` whole-object equality).
> Tests: the round-5 `describe` block in `decision-supersede.test.ts` (7 none, 15 card, 1 subject card, 8 auto, 1 frame_only
> card) and the compound case in `decision-supersede-card.test.ts` (card opens, old decision unchanged). The 601398a27
> domain file fails them (`fail-without-fix.txt`, last section).

## Stack (no Docker)

Same shape as round 5 (`evidence/phase-18/r05/`): local Postgres 16 + AGE + pgvector at 127.0.0.1:55432, own db `r08e`
(migrated from `apps/api` with `pnpm -s run migrate`, including `20260926140000_kg_i4290_decision_supersede.sql`), own
`redis-server` on 58815, `apps/api` via `tsx src/main.ts` (`KG_EXTRACTION_ENABLED=1`, extraction + projection workers
in-process) on 58812, `apps/web` via `next dev` on 58813, loopback model on 58814, Chromium from `/opt/pw-browsers`.
Exact commands: `harness/stack.sh.txt`. All processes were stopped, `r08e` dropped, and `next dev`'s `tsconfig.json`
auto-edit reverted afterwards.

**Model: substitute, disclosed.** `apps/api/scripts/loopback-kg-eval-model-provider.ts` fed the two-sentence corpus
`harness/cases-r08.json`: 「我决定关注 211 高校」 → one `decision` claim; 「改成关注 985 吧」 → one `decision` claim whose
statement the "model" normalises to 「改成关注 985 高校」. Chat answers only echo the 【记忆】 block the executor handed
the model that turn, so what an answer contains is what was recalled. No real model was called. Everything downstream —
extraction worker, F16 conflict check, the new supersede step (`detectSupersedes` → `kg_supersede_candidates` →
`findSupersedes` → `kg_apply_supersedes`), promotion, `PgKnowledgeRecall`, `getTurnMemory.supersede`, the answer line,
`applyHumanAction{undoSupersede}` → `kg_undo_supersede` — is the product path.

**Seed.** `scripts/seed-kg-experience-eval.ts`, then `harness/r08-post-seed.ts.txt` (re-enables org extraction with the
test fixture `enableExtraction`, as round 5).

**Manual promotion, disclosed.** Supersede does not copy the new decision into personal space — that is #4283 (round 7,
not merged at the time of this run). So step A promotes 211 and step B promotes 985 through the memory panel, as round 5
did. After #4283 both promotions go away.

## Steps

| # | Step | Result | Evidence |
|---|------|--------|----------|
| A | Personal thread A: 「我决定关注 211 高校」 → extracted as a decision, promoted to personal space | PASS | `01-a-decision-promoted.png`, `journey.json` `stepA_personal` |
| B | New personal thread B: 「改成关注 985 吧」 → `getTurnMemory.supersede = applied`; under the answer 「已用〈改成关注 985 高校〉取代〈我决定关注 211 高校〉 · 撤销」; 211 gone from `/knowledge-graph/personal`. (B's own answer still quotes 211: it was generated before B's extraction ran.) Then 985 promoted | PASS | `02-b-supersede-notice.png`, `03-b-new-decision-promoted.png`, `journey.json` `stepB` / `stepB_personal_after_supersede` |
| C | New personal thread C: 「开始写报告吧」 → answer 「根据之前的对话：改成关注 985 高校（来自个人空间知识…）」, `recalled` = [985 personal claim] only, no 211 | PASS | `04-c-answer-only-985.png`, `journey.json` `stepC` |
| undo | Back in B, click 「撤销」 → 「已撤销：〈我决定关注 211 高校〉恢复为生效」; personal space has both | PASS | `05-b-undone.png`, `journey.json` `stepUndo` |
| D | New personal thread D: 「开始写报告吧」 → answer carries both decisions | PASS | `06-d-answer-both-after-undo.png`, `journey.json` `stepD` |

`db-proof.txt`: final claim rows (211 personal copy restored to `accepted`, not revoked), the `kg_supersede_notices` row
(`status = undone`, `undone_by`, the undo snapshot: prior status + the two edges the F07 cascade had invalidated), the
`supersedeDecision` (system, `kg-supersede-detector`) and `undoSupersede` (human) audit actions, and `kg_turn_recalls`.

## Automated tests (same branch)

- `apps/api/tests/knowledge-graph/decision-supersede.test.ts` — the pure domain judgment (37 cases: explicit change →
  supersede; addition / no signal / different author / different kind / question / hypothetical / ambiguous → not).
- `apps/api/tests/knowledge-graph/decision-supersede-recall.test.ts` — real DB + app: A→B→C recalls only 985; undo restores
  211 (and its `derived_from` edge), notice reads `undone`, second undo 404 `KG_PROMPT_NOT_FOUND`, a job retry does not
  re-supersede, D recalls both; 「也关注 985 高校」 supersedes nothing; in a project thread another member's change of mind
  does not supersede mine, my own does.
- `fail-without-fix.txt` — the integration test with the supersede step removed: thread C's memory still contains 211.
- `apps/api/tests/knowledge-graph/decision-supersede-card.test.ts` — (after the 「高把握自动、低把握弹卡」 decision) real DB +
  app: 「改成关注 985 吧」 (`frame_only`) opens a `possible_change` card and supersedes nothing, both decisions stay
  un-contested and are both recalled; [取代] supersedes 211 and C recalls only 985; [两条都保留] closes the card and leaves
  both; another user gets the same 404; 「改成采用 Rust 不现实」 / 「关于周会，改成采用飞书」 open no card.
- `apps/web/tests/ui/kg-supersede-notice.test.tsx` — the answer line and its undo wiring (request body checked against
  the contract).

## Files

- `journey.json` — ids, per-step answer text / notice / recalled / personal space
- `db-proof.txt`, `fail-without-fix.txt`
- `harness/` — Playwright spec + config (run from `apps/web` against the running stack; removed from the source tree
  after the run), corpus, post-seed script, stack commands, `playwright-run.txt` (5 passed)
