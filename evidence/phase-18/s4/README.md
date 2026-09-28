# S4 (#4361) — manage memory in the conversation: 「忘掉关于 X 的」「我改主意了，改成 Y」「你记得我什么」

Branch `s4b`, built on `a461bb0ad` (r11b / #4344 with origin/main merged). Scope rule from #4361: everything acts only on
the **requester's own personal space** (long-term memory + all of the requester's personal threads, the F15 scope).
Project-thread memory and other users' memory are never touched.

## What changed

| Intent | Detection (`domain/knowledge-graph/memory-intent.ts`, deterministic) | What happens |
|---|---|---|
| 忘掉 X | F17 prefix rules (unchanged), plus 「忘掉关于 X 的」 now strips a trailing 「的」 | Forget card lists matches from the whole personal space (other personal threads included). Confirm ⇒ F07 cascade; forgetting a long-term item also forgets its live `derived_from` sources in the requester's own personal threads. The done card has **撤销** (`undoMemoryCard`, restores claims + L1 copies + cascade-invalidated edges from a snapshot). Project threads: no card, an honest note. |
| 我改主意了 → Y | Optional 「我改主意了 / 改主意了 / 想法变了 …」 lead + one change clause that passes R8 `hasChangeSignal`; single sentence, not a question | `application/knowledge-graph/change-mind.ts`: scope gate (`kg_memory_manage_ok`) → **R8 `planSupersedes` pre-plan** on the requester's live long-term decisions (allowlist untouched) → nothing matched / opposition ⇒ nothing written. Otherwise the change clause is applied as this message's extraction result (same idempotency key as extraction) and R8 `detectSupersedes` runs unchanged: explicit / aligned same_kind ⇒ automatic, 「已用〈新〉取代〈旧〉 · 撤销」; frame_only ⇒ 「用〈新〉取代〈旧〉？」 card. The new decision is then auto-copied to long-term memory (#4283 path). Runs before recall, so the model never gets the superseded wording. |
| 你记得我什么 | Whole-sentence patterns only (「你记得我昨天说的方案吗」 is not it) | `kind = overview` card: live personal-space memories grouped by kind (contract `KG_CLAIM_KIND_DISPLAY_ORDER` / `KG_CLAIM_KIND_LABEL_ZH`), each with a link to its source conversation; no actions. The model gets the same grouped list. Project threads: no list, an honest note. |

Agent tool: no `wx_forget` was added. The deterministic path covers user-stated forgetting; `wx_remember` stays the only
agent memory tool and still only opens a card.

DB: migration `20260928161000_kg_i4361_manage_memory_in_chat.sql` (rebuilds `kg_open_memory_card`,
`kg_act_on_memory_card`; adds `kg_undo_memory_card`, `kg_memory_manage_ok`, helpers; `kg_memory_cards` gets
`overview` / `undone` / `restore`). Lock order stays "sessions (sorted) → personal".

Signed-contract changes are **treated as approved, sign off later**; listed in
[`../r10/README.md`](../r10/README.md) §3.2.

## Tests

- `apps/api/tests/knowledge-graph/memory-manage-in-chat.test.ts` (15, real DB): intent positives / negatives
  (「遗忘曲线」「我忘了密码」 never forget), cross-thread forget + cascade + undo, undo only restores what the card
  forgot, stale undo, project threads, authorization (foreign / missing card ⇒ identical 404, agent ⇒
  `KG_ACTOR_NOT_HUMAN`, raw DB call ⇒ `KG_NOT_OWNER`), R8 tiers (auto + undo, frame_only card, opposition /
  unrelated ⇒ nothing, with a positive control), overview grouping / sources / live filtering / no actions.
- `apps/api/tests/knowledge-graph/memory-card.test.ts`: 3 F17 expectations updated for the new scope rules;
  `recall-repo-guard.test.ts` pins the new call signature.
- `apps/web/tests/ui/kg-memory-manage.test.tsx` (8): forget undo UI, overview card, TurnMemoryLine wiring.
- Fail-without-fix: `fwf-api.txt` (all 15 new API tests + 3 changed F17 + guard fail on the base code) and
  `fwf-web.txt` (8/8 fail).

## Real-browser journey — 11/11 PASS (`harness/playwright-run.txt`, 42 s)

**Stack (no Docker).** Own PG16 + AGE + pgvector cluster (port 55479, db `s4be2e`, migrated + seeded with
`scripts/seed-kg-experience-eval.ts` + `harness/s4-post-seed.ts.txt`), own `redis-server`, `apps/api` via `tsx
src/main.ts` with `KG_EXTRACTION_ENABLED=1` (extraction + projection workers in-process), `apps/web` as
`next build && next start` (dist `.next-s4b`; `next dev` was OOM-killed repeatedly on the shared box), Chromium from
`/opt/pw-browsers`. Commands: `harness/stack.sh.txt`. Spec and config were copied into `apps/web` for the run and
removed afterwards (copies in `harness/`). Everything was stopped and the databases dropped afterwards.

**Model: a stand-in, disclosed.** `apps/api/scripts/loopback-kg-eval-model-provider.ts` ran **unmodified** with
`harness/cases-s4.json` (three sentences, one claim each). The change-of-mind sentences are deliberately **not** in the
corpus: the loopback extracts nothing from them, so every supersede / card below comes from the S4 turn-time path, not
from extraction. Chat answers only echo the memory material the executor handed the model.

| # | Step | Result | Evidence |
|---|---|---|---|
| setup | A, personal thread P1: fact 「客户A的对接人是王经理」, decision 「我决定关注 211 高校」 (auto-copied to long-term memory), todo 「周五之前把报价单发给客户A」 | PASS | `journey.json` `setup` |
| overview | New thread P2 「你记得我什么？」 → list card grouped 决定 / 事实 / 待办, every item links 「来自「P1 title」」 to `/chat/P1?memory=1`, no buttons; the link opens P1 with the memory tab | PASS | `01-overview-grouped.png`, `02-overview-source-link.png`, `overview` |
| overview − | 「你记得我昨天说的方案吗」 → ordinary recall, no list card, `prompt: null` | PASS | `overviewNegative` |
| change auto | P3 「我改主意了，改成关注 985 高校」 → 「已用〈改成关注 985 高校〉取代〈我决定关注 211 高校〉 · 撤销」 in the same turn; long-term memory has 985, not 211 | PASS | `03-change-auto-superseded.png`, `changeAuto` |
| change card | P4 「我改主意了，改成关注 C9」 (`frame_only`) → `possible_change` card 「用〈改成关注 C9〉取代〈改成关注 985 高校〉？」, both live; picked 两条都保留 | PASS | `04-change-card.png`, `changeCard` |
| change none | 「改成关注北大，我反对」 → no notice, no card, long-term memory unchanged | PASS | `05-change-opposition-nothing.png`, `changeNone` |
| change undo | Back in P3, 「撤销」 → 211 live again | PASS | `06-change-undone.png`, `changeUndo` |
| forget | New thread P5 「忘掉关于王经理的」 → card lists P1's memory; 忘掉 → 「已忘掉 1 条 · 撤销」, gone from P1; 撤销 → 「都恢复了」, back in P1 | PASS | `07/08/09-forget-*.png`, `forgetDone`, `forgetUndone` |
| forget − | 「我们来聊聊遗忘曲线」「我忘了密码」 → no card, nothing forgotten | PASS | `10-forget-negatives-no-card.png`, `forgetNegative` |
| project | Shared project thread 「忘掉关于王经理的」 → no card | PASS | `11-project-no-forget-card.png`, `projectForget` |
| privacy | B: undo on A's card → 404 `KG_CARD_NOT_FOUND`, identical to a nonexistent card; B reading A's overview turn → 404; B's own 「你记得我什么」 → no card, none of A's memories on B's page | PASS | `12-privacy-b-empty.png`, `privacy` |
