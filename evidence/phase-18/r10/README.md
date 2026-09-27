# Round 10 — final acceptance of the phase-18 chat knowledge graph iteration (#4309)

Branch `r10` from origin/main `d2465984c` (R9 #4305 merged). This round is evidence only. No product code was
changed. It contains three things:

1. **F15 memory-experience eval, R4 = 9.4 / 10.** It was re-scored on current main, and every dimension matches R3
   (see [`../../kg-experience-eval/R4.md`](../../kg-experience-eval/R4.md)).
2. **Real-browser cross-session acceptance journey.** Two users, one org and one project, covering #4283, #4284,
   #4290 (auto, card and none) and #4302. **10/10 PASS.**
3. **Signoff package.** Every human decision in this iteration, the items still waiting for human signoff, and the
   known open issues.

---

## 1. F15 eval R4 vs R3

`rubricHash()` = `3796053d1d1bd05dac14433e4beea45317befd46717bce7b284596de946733b1`. This equals the latest
amendment (R3) in `rubric-lock.json`, and no new amendment was added. The run used the stack from
`evidence/kg-experience-eval/README.md`: the unmodified loopback model, the seed, `KG_EXTRACTION_ENABLED=1`, and
`next build && next start`, against local PG16 + AGE + pgvector (db `r10eval`) and an own `redis-server`, on ports
59012/59013/59014/59016. Result: 44 passed, 2 failed (8.8 min). After the run, `score.mjs --round R4` was scored,
`shots/R3` was deleted, and an R4 row was added to the README. `score-gate.test.ts`: 6/6.

| Dim | R3 | R4 |
|---|---|---|
| E1 零负担 | 1.00 | 1.00 |
| E2 记得住 | 1.00 | 1.00 |
| E3 答得对 | 0.75 | 0.75 (E3.c4, F05 vector baseline, existing) |
| E4 有出处 | 1.00 | 1.00 |
| E5 改得快 | 1.00 | 1.00 |
| E6 看得懂 | 1.00 | 1.00 |
| E7 会提醒 | 1.00 | 1.00 |
| E8 不打扰 | 1.00 | 1.00 |
| E9 放心 | 0.67 | 0.67 (E9.c2, 403 vs 404, existing, awaits a human ruling) |
| E10 不卡顿 | 1.00 | 1.00 (first-token median 538 ms on / 504 ms off; R3 550 / 561) |
| **Total** | **9.4** | **9.4** |

No dimension dropped, and no regression was found.

---

## 2. Cross-session acceptance journey (real browser, real local stack)

**Stack (no Docker).** Local Postgres 16 + AGE + pgvector at 127.0.0.1:55432 with its own db `r10e2e`, migrated,
then seeded with `scripts/seed-kg-experience-eval.ts` + `harness/r10-post-seed.ts.txt`. The post-seed re-enables
extraction with the fixture `enableExtraction`, and makes A and B project facilitators. Around that:
- an own `redis-server` on 59016;
- `apps/api` via `tsx src/main.ts` on 59012, with `KG_EXTRACTION_ENABLED=1` and the extraction and projection
  workers in-process;
- `apps/web` via `next dev` on 59013 (same-origin proxy `/__fullstack_api`);
- the loopback model on 59014;
- Chromium from `/opt/pw-browsers`.

The exact commands are in `harness/stack.sh.txt`. Afterwards, everything was stopped, both dbs were dropped, and the
temporary spec, config and post-seed were removed from `apps/web` / `apps/api`. Copies are kept in `harness/`.

**Model: a stand-in, disclosed.** `apps/api/scripts/loopback-kg-eval-model-provider.ts` ran **unmodified**. The
assistant-extraction patch from r07 was **not** applied, and no file under the F15 fingerprint was touched. The
loopback reads `harness/cases-r10.json`: five user sentences, each extracting exactly one `decision`. Everything
downstream is the product path.

Because the loopback cannot extract assistant messages, the #4284 check that the project gains no claim from A's
answer is **not** proven by the answer's claim count, which would be 0 anyway. It is proven by the gate itself:
- the API log has `kg extraction skipped: project-thread answer used personal memory … outsideRecallItems: 1` for
  both of A's project-thread answers;
- `db-proof.txt` shows `queued = 0` for them;
- r07 already showed the non-vacuity control, where the same answer text in a personal thread *is* extracted when
  assistant matching is on.

**Users.** A = `KG_EVAL.owner` (王经理), B = `KG_EVAL.other` (隔壁同事), in the same org and project. Shared project
threads were created with A's own session through `POST /chat/threads/mutate` with `visibilityScope: "plenary"`.
This is the same deviation as r07: the v2 「新对话」 button in a project makes a private thread.

**「低把握」 for the card step** means the #4290 `frame_only` tier, not the extraction confidence (0.9 throughout).
The tier of each journey sentence was checked in advance with the pure function `planSupersedes`. See
`harness/supersede-probe.ts.txt` and `harness/supersede-probe-output.txt`.

| # | Step | Result | Evidence |
|---|---|---|---|
| #4283 a | A, personal thread P1: 「我决定关注 211 高校」. The chip reads 「已记下：我决定关注 211 高校 · 已记入个人记忆 · 撤销」. No promote was clicked. `/knowledge-graph/personal` and A's `/brain` list 211. | **PASS** | `01-4283-P1-chip.png`, `02-4283-brain-211.png`, `journey.json` `s4283_a*` |
| #4283 b | A, shared project thread T1: 「我决定关注双一流高校」. The chip reads 「已记下：… · 撤销」, **without** 「已记入个人记忆」. After 6 s of extra ticks, A's personal space still holds only 211. The claim stays `chat_session` in T1, and no `derived_from` edge exists for it. | **PASS** | `03-4283-project-decision-not-copied.png`, `s4283_b`, `db-proof.txt` |
| #4284 a | A, shared project thread T2: 「开始写报告吧」. The answer is 「根据之前的对话：我决定关注 211 高校（来自个人空间知识…）」. A's citation chip shows 211. Turn memory is exactly `[[p211, personal]]`. | **PASS** | `04-4284-A-project-answer-cites-211.png`, `s4284_a` |
| #4284 b | B opens T2 12 s later. Citation chips: none. `getTurnMemory.recalled`: `[]`. Extraction feedback: `{claims: []}`. Knowledge panel for B (API and UI) and for A: empty. Sources of A's personal 211 for B: 404, identical to a nonexistent id. Project gains no claim from A's answer: `queued 0 / claims_from_it 0`, and the gate log line is present. | **PASS** | `05-4284-B-views-A-turn.png`, `06-4284-B-panel-empty.png`, `s4284_b`, `db-proof.txt` |
| #4290 auto | A, new personal thread P2: 「改成关注 985 高校吧」 (`same_kind`). The notice reads 「已用〈改成关注 985 高校〉取代〈我决定关注 211 高校〉 · 撤销」 and the personal space is `[985]`. New thread P3: 「开始写报告吧」. The answer carries 985 only, and the recall is `[p985]`. | **PASS** | `07-4290-auto-notice.png`, `08-4290-P3-recalls-only-985.png`, `s4290_auto*` |
| #4290 card | A, new thread P4: 「改成关注 C9 吧」 (`frame_only`). No notice. The card reads 「用〈改成关注 C9〉取代〈改成关注 985 高校〉？ [取代] [两条都保留]」 (`possible_change`). While the card was open, new thread P5 recalled **both** C9 and 985 and the answer contains both. **Choice recorded: 两条都保留** (`keep_both`). The card closed with 「两条都保留了」, both stay live, and the prompt is `kept_both`. | **PASS** | `09-4290-card-open.png`, `10-4290-card-open-P5-recalls-both.png`, `11-4290-card-keep-both.png`, `s4290_card*`, `db-proof.txt` |
| #4290 none | A, new thread P6: 「改成关注985高校，我反对」. `supersede: null` and `prompt: null`, with no notice and no card in the UI. 985 and C9 are unchanged. `kg_conflict_prompts` still has one row and `kg_supersede_notices` still has one. Control from the pure function: the same sentence without 「，我反对」 against C9 gives a card. | **PASS** | `12-4290-none.png`, `s4290_none`, `db-proof.txt`, `harness/supersede-probe-output.txt` |
| #4302 a | A's `/brain`: 985 with 「来自你 9/27 的对话」 (browser-local date of `saidAt`), badge 「AI 记下的」, and the folded 「取代了：我决定关注 211 高校」 with 「撤销取代」. 211 is not listed as live. | **PASS** | `13-4302-brain-985-folded-211.png`, `s4302_a` |
| #4302 b | 「撤销取代」 returns 200 and 211 comes back live. 「忘掉这条」 on 985 calls `/personal-copy/undo` and returns 200. 985 is gone, and still gone after a reload, while 211 stays. Audit: `undoSupersede` (session + personal) and `undoAutoCopy`, all human. | **PASS** | `14-4302-after-undo-supersede.png`, `15-4302-after-forget-985-reload.png`, `s4302_b*`, `db-proof.txt` |
| #4302 c | B's `/knowledge-graph/personal` has `claims: []` and `replaced: []`. The overview is empty. B's `/brain` shows the empty state, with none of 211, 985, C9 or 双一流 on the page. | **PASS** | `16-4302-B-brain-empty.png`, `s4302_c` |

Playwright output: `harness/playwright-run.txt`, 10 passed (4.1 min) on the first run.

**Observations (not regressions):**
- The corpus lets the loopback extract 「改成关注985高校，我反对」 as a decision, standing in for a model that reads it
  that way. So #4283 auto-copies it and it shows on `/brain` as its own item (screenshot 13). The #4290 rules
  correctly refuse to let it supersede anything. Whether a real extraction model would record a sentence like that
  as a decision at all is a question about extraction quality, not about #4290.
- A's answer in T1 (the project decision thread) also recalled A's personal 211 through the forced personal
  decision recall. So it was *also* skipped by the #4284 gate: there are two gate lines. This is the
  「几乎都不抽」 cost that `usecases.md` records as awaiting signoff (see §3.2).

---

## 3. Signoff package

### 3.1 Human decisions in this iteration

Sources: `git log origin/main`, the commit and PR bodies, and `usecases.md`. "Date" is the date of the decision
where the repo records it, otherwise the merge date. **(unconfirmed)** marks anything the repo does not state.

| PR | Merged | What was decided / done | Where the evidence is |
|---|---|---|---|
| #4200 | 2026-09-26 | The deployment-level extraction gate moves from the `KG_EXTRACTION_ENABLED` env var to a DB row that a platform admin can toggle (`kg_extraction_state`, default on, echoing the org-level 「默认开」 instruction). The commit says this unblocks ops without SSH. **(unconfirmed)** The repo does not record a separate human instruction for this PR beyond the commit message. | commit `4775bab97`; migration `20260925120000`; admin UI followed in R2 #4281 |
| #4237 | 2026-09-26 | The deploy step 4d3 `purge-postinvest-agents --apply` warns instead of aborting the deploy. The actual purge is to move to a one-off migration. **(unconfirmed)** The repo does not record whether this was a human decision or an agent fix. | commit `51553eab9` |
| #4239 | 2026-09-26 | Org-level extraction defaults to **on** (human, twice: 「默认是打开的」). Existing `enabled=false` rows are not backfilled. Test orgs get an explicit off row from `seedOrg`. | commit `93ec661f4`; migration `20260926100000`; `usecases.md` L234–237 (**awaits signoff**) |
| R1 #4273 | 2026-09-26 | Graph recall works on hub entities (#4175). The CN release builds and ships the pgvector + Apache AGE postgres image (#4081). | commit `9dc8ec610`; `docs/deployment/cn-production-rollout.md` step 4 |
| R2 #4281 | 2026-09-26 | Platform-admin UI for the deployment extraction switch (#4247). The org switch says 「未生效：这个部署没有开启记忆抽取」 when the deployment is off. Toggle disabled-style fixes. | commit `ae5661a9c`; `evidence/phase-18/r03/4247-*.png`, `4247.json` |
| R3 #4287 | 2026-09-26 | #4271 round 3. The extraction feedback chip never showed (clientMessageId lookup). Forced decision recall stored `score = Infinity` and so hid the whole answer footer. Found in a real browser. | commit `00171a2f8`; `evidence/phase-18/r03/` |
| R4 #4282 | 2026-09-26 | AGE projection writes each canonical edge exactly once (#4270). Fail closed, plus a one-time dedupe. | commit `6afedd63b` (tests only; no evidence dir) |
| R5 #4289 | 2026-09-26 | #4278: promoted personal decisions are force-recalled in new chats. The human answered open question (c) on 2026-09-26: personal memory applies in project threads for the requester only (#4284), and decisions auto-enter the author's personal space (#4283). | commit `52b0677dc`; `evidence/phase-18/r05/`; `usecases.md` L193 |
| R6 #4301 | 2026-09-27 | Eval R3 is back to 9.4. The seed re-enables extraction, and 「跳到原消息」 no longer gets pulled back to the bottom. The human authorised registering rubric amendment R3 on 2026-09-26. | commit `af8aa94ba`; `evidence/kg-experience-eval/R3.*`, `rubric-lock.json` |
| R7 #4291 | 2026-09-27 | Human 2026-09-26. **#4283**: the author's own decisions are auto-copied into the author's personal space, undoable, personal threads only. **#4284**: personal memory is used for the requester's own turn in project threads and shown only to them. A project answer that used personal memory is not extracted. | merge `c06bf1d92`; `evidence/phase-18/r07/`; `usecases.md` L211–232, L239–256 |
| R8 #4294 | 2026-09-27 | #4290, human 2026-09-26. Only an explicit change of mind supersedes. Then re-decided: 「高把握自动、低把握弹卡」, where the auto path is allowlist-only and `frame_only` gives a card. | commit `cfcfc27f1`; `evidence/phase-18/r08/`; `usecases.md` L195–208 |
| R9 #4305 | 2026-09-27 | #4302, human 2026-09-26. `/brain` shows 「来自你 M/D 的对话」 and a folded 「取代了：…」, and gets 「忘掉这条」 and 「撤销取代」, both reusing existing actions. Review fix: F07 counts only active `derived_from` edges. | commit `d2465984c`; `evidence/phase-18/r09/`; `usecases.md` L122–158 |

### 3.2 Still awaiting human signoff

**Nothing here was signed by an agent.** `design-signoff.md` is still `status: pending` and was not edited. All
links point to [`usecases.md`](../../../phases/phase-18-org-brain-knowledge-graph/signoff-draft/chat-knowledge-graph/usecases.md)
unless noted.

- [ ] **Invariant exceptions I-9 / I-14 (write side) for #4283** (§「已决…issue #4283」 → 「不变量例外」, L223–227).
  An auto copy stays `proposed`, with `created_by = model` and no promoter (I-9 relaxed). The system identity
  writes into the evidence author's personal space (I-14 write side). Reads are unchanged.
- [ ] **#4284 known trade-off** (§「已决：个人记忆也用于项目会话…」 → 「已知取舍」 L251 and 「实际范围」 L255). The answer
  text is visible to project members and may paraphrase the requester's personal memory. An answer that used
  personal memory is not extracted at all, so once a person has a personal decision, almost none of their
  project-thread answers are extracted (seen again in this round: both T1 and T2 answers were skipped).
- [ ] **UC-KG-7 / UC-KG-13 now writable** (L122–158). `/brain` got 「忘掉这条」 / 「撤销取代」 (human 2026-09-26). Still
  open: [`design-signoff.md`](../../../phases/phase-18-org-brain-knowledge-graph/signoff-draft/chat-knowledge-graph/design-signoff.md)
  §二.3 asks whether to keep or delete `getPersonalKnowledge`, and `/brain` now depends on it (L158).
- [ ] **Org extraction default on** (§「待签核确认（组织级抽取开关默认值…）」, L234–237). The privacy trade-off is that new orgs'
  chats are extracted unless an admin turns it off. Rollback is one migration.
- [ ] **#4290 rules** (§「待签核确认（issue #4181…）」 item 5, L195–208). Explicit change only, same author only. Auto
  applies only to the allowlisted `explicit` and aligned `same_kind` tiers, `frame_only` gives a card, and
  retraction, question and verdict give nothing. Only the thread creator can undo in project threads.
- [ ] **Eval rubric amendments R1–R3**
  ([`rubric-lock.json`](../../kg-experience-eval/rubric-lock.json) `amendments`,
  [`README.md`](../../kg-experience-eval/README.md) round table). R1: E4 「原话」 accepts any corpus sentence, and
  `say()` waits for 「发送」. R2: tightening only (non-empty excerpt, same claim). R3: the seed re-enables extraction,
  authorised 2026-09-26. R4 added no amendment.
- [ ] Also open in the same file:
  - F17 card-state semantics (L105–110);
  - the F15 cross-session recall scope and the **E9 403 vs I-3 404** conflict (L181–184), which is the E9.c2 red;
  - #4181 items 1–4: decision budget, keyword list, manual undo entry, and L1 forced recall (L186–193).

### 3.3 Known open issues

- **#4307**: listed by the coordinator. Its content is **not recorded in the repo** and was not verified here.
- **Supersede chains lose history** (review note). When A→B→C are superseded in turn, the earlier history of the
  chain is not fully shown. **(From review; not recorded in repo docs and not reproduced in this round. This
  journey had only one automatic hop, 211→985.)**
- **「但是 。。」 with a space** (review note). The #4290 「连续两个以上的分句标点算省略号 ⇒ 卡」 rule (L204) may not
  catch repeated punctuation separated by a space. **(Not reproduced in this round.)**
- **Aliyun RDS and `age`**. `docs/deployment/cn-production-rollout.md` step 4 requires managed RDS to provide the
  `age` extension, or graph recall returns `KG_GRAPH_UNAVAILABLE`. The repo does not confirm that Aliyun RDS
  offers it. This needs a human or ops answer.

## Files

- `README.md` (this file) and `journey.json` (ids, chip, notice and card text, per-turn answers and recall, B's view
  of every read path, and the /brain states).
- `db-proof.txt` (`harness/db-proof.sql`): threads, decisions (scope, status, reason), `derived_from` edges,
  supersede notices, conflict prompts, `kg_turn_recalls`, agent answers with queue and claim counts, human audit
  actions, and the API gate log lines.
- Screenshots `01-…png` to `16-…png`.
- `harness/`: `journey.spec.ts.txt`, `playwright.r10.config.ts.txt`, `cases-r10.json`, `r10-post-seed.ts.txt`,
  `stack.sh.txt`, `db-proof.sql`, `playwright-run.txt`, `supersede-probe.ts.txt`, `supersede-probe-output.txt`.
