# S6 (#4363, epic #4359): the time dimension of memory — validity, todo status, chained supersede history; #4307

North star: a new chat must not re-surface stale background (「这周我在上海出差」 a week later), must not treat a finished
todo as open, and /brain must show how a decision evolved (211 → 985 → 清华), not just its last hop.

## What changed (design in one screen)

| Area | Decision |
|---|---|
| Validity | `claims.valid_from` / `valid_to` already existed since F02 (with `claims_validity_chk`) and were never written. **No second column**: the contract calls it `validUntil`, it is stored in `valid_to`, left-closed right-open. |
| Extraction | The model only returns the time expression verbatim (`timeExpr`, one sentence in the prompt + one schema field, `kg-extract@3`). Calendar math is a pure, deterministic function (`domain/knowledge-graph/claim-time.ts`, UTC+8, keyed to the **message** time, not the job time). Unknown expressions ⇒ no validity (never guess 「过期」). A todo's expression is its **due date** (`due_at`), not an expiry. |
| Expired ⇒ not recalled | One predicate (`claimExpired` / `recallable`) used by recall scoring, the vector candidate list (so expired claims do not eat top-k) and the forced decision / goal recall. /brain and the panel still list them, marked 「已过期」 (`KgClaim.expired`, computed by the same function). |
| Copies | A personal / project / org copy inherits validity, due date and todo status from its **first** `derived_from` source (AFTER INSERT trigger). Merging a second source never makes a permanent memory expire. |
| Todo status | `claims.todo_state` (open / done / dropped; CHECK, default trigger, backfill of existing todos). New owner-only op `setTodoStatus` (`POST /knowledge-graph/claims/:claimId/todo-status` → `kg_set_todo_state`): thread creator or personal-space owner; everything else, including "not visible", is `KG_CLAIM_NOT_FOUND`. Linked session/personal copies change together; one human audit action per scope. 「不做了」 is not recalled; 「做完了」 is recalled and labelled 「（待办·已完成）」 for the model. Chat-driven 「那个做完了」 is **not wired yet**: future work for S4's intent path, which should call this same domain operation. |
| Chained history | `getPersonalKnowledge.replaced` now walks old → direct successor → … → live claim (`domain/knowledge-graph/supersede-chain.ts`). Entries carry `step` / `replacedBy` (omitted for step 1, so R9 consumers are unchanged). Only the step-1 link can be undone (the R9 rule); undoing it makes the older link step 1 again. Chains through a forgotten claim or a cycle are not shown. |
| #4307 | `kg_apply_supersedes` collects personal copies only along **active** `derived_from` edges (`CREATE OR REPLACE`, one-line change). The undo path restores from the notice snapshot, which no longer contains the detached copy — symmetric without changes. |
| Ranking | Among claims with equal relevance and equal fused rank: query intent (「谁定的」) first, then **newer first**, then tri-state. S9 fusion (channel ranks, relevance, RRF) is untouched. |

Migration: `apps/api/migrations/20260928170000_kg_s6_time_dimension.sql` (sorts after the newest on origin/main `20260928150000`;
checked after merging origin/main).

## Tests (fail-without-fix proof: see the last column; two SQL-level red runs are missing)

| Test | What it proves | Without the fix |
|---|---|---|
| `apps/api/tests/knowledge-graph/claim-time.test.ts` (35) | expression → range (incl. Sunday-night / past-month edge cases, unknown ⇒ null); extraction → validity vs due; executor rejects flipped windows; recall drops expired / dropped, labels done, newer-first on ties, relevance still wins; chain order / undo only on step 1 / broken chain / cycle | recall.ts reverted ⇒ 3 recall cases fail (`fail-without-fix/api-read-and-recall.txt`) |
| `apps/api/tests/knowledge-graph/supersede-active-derived-from.test.ts` (2) | #4307 reproduced through the real pipeline (merge → `undoAutoPersonalCopy` detaches → supersede); the detached copy stays live; undo snapshot contains only the session claim; control with an active edge still supersedes the copy | pre-S6 `kg_apply_supersedes` restored in a fully migrated DB ⇒ the detached copy is superseded — **run not completed, see Status** |
| `apps/api/tests/knowledge-graph/time-dimension.test.ts` (7) | 「这周」 said 10 days ago is expired and not recalled in a new thread while 「到年底」 is; the auto-copied decision inherits validity, is marked expired on /brain and is no longer force-recalled; todo open + due; owner-only API (other member 404, bad status 400, non-todo 404), revision advances; promote inherits status; setting 「不做了」 on the copy updates both and drops it from recall; audit per scope; the migration's backfill statement fills a pre-migration todo row | copy-inheritance trigger dropped ⇒ the decision copy has no validity — **run not completed, see Status** |
| `apps/api/tests/knowledge-graph/brain-supersede-chain.test.ts` (3) | literal 211 → 985 (auto) → 清华 (card, [取代]) ⇒ 清华: [985 step 1, 211 step 2]; all-auto chain 211 → 985 → C9: undo only on the top link, after undo 211 hangs under 985 with undo; privacy | pg-knowledge-read.ts reverted ⇒ both chain cases fail (211 disappears) (`fail-without-fix/api-read-and-recall.txt`) |
| `apps/web/tests/brain/brain-time-dimension.test.tsx` (5) | /brain orders the chain newest first (「取代了：…」 / 「更早是：…」), only the top link has 撤销取代; 「已过期」 badge with text; todo status buttons call the API and re-read | page + `brain-view.ts` reverted ⇒ 3/5 fail (`fail-without-fix/web-brain.txt`); the other 2 cover the new badge component itself and the banned-word scan |

Existing suites re-run green on this branch: `brain-screen.test.tsx` (22), `recall-ranking` (15), `recall-vector-fusion`
(14), `message-extraction` (9), `extraction-repo-guard` (9), `recall-repo-guard` (12, one pin updated: the vector
candidate list may only be **narrowed** by `recallable`), `executor-invariants` (24), `age-projection-worker`,
`brain-overview`, `decision-auto-personal-copy`, `decision-supersede-card`, `decision-supersede` (316), `e2e-zero-leak`,
`get-thread-knowledge-api` (test double gained `setTodoStatus`), `graph-neighbors-anchored`, `memory-card`,
`personal-memory-project-thread`, `promote-to-personal`, `remember-tool`. `extraction-agent` needed one expectation
update (parse result now carries `timeExpr: null`). `e2e-north-star-recall` caught that recency must not beat the
「谁定的」 intent tie-break — fixed before commit (intent first, then recency).

Lints run: contract-route-coverage, body-path-param-leak, contract-negative-assertion, ui-wiring, e2e-testid-gate,
user-facing-error-text, contract-state-names, vocabulary, permission-paths, no-builtin-capabilities,
global-scope-test-fixtures, naming-single-source, arch-deps, contract-source — all ✅. `lint-error-leak` timed out
(30 min) on the loaded machine and was not re-run.

## Real browser

Harness in `harness/` (stack.sh, cases-s6.json for the **unmodified** KG-eval loopback model, journey.spec.ts,
playwright config, db-proof.sql).

## Status: NOT done (honest list)

- **Real-browser journey did not complete.** The stack (own DB `s6e2e`, redis, API, `next dev`, loopback) came up, but
  at load average 110–160 `next dev` took 745 s to compile `/login` and never finished compiling `/chat` (>1 h); the one
  Playwright attempt timed out in `newThread` (`page.goto /chat`). No screenshots exist. The spec is kept in
  `harness/journey.spec.ts.txt` and is ready to run on a quieter machine.
- **SQL fail-without-fix — **run not completed, see Status** was never produced.** Two attempts hit vitest hook timeouts
  under load. The third (pre-S6 `kg_apply_supersedes` restored + inheritance trigger dropped in a fully migrated DB,
  catalog check confirmed: fixed line absent, trigger count 0 — see `harness/nofix-sql.sh.txt`) was stopped when the
  session ended. The #4307 and copy-inheritance tests therefore have green-with-fix proof only; the red run is missing.
- `lint-error-leak` timed out and was not re-run. The turbo `typecheck lint` run for api/web/contracts did not finish
  either (2 h; 5/7 tasks done, no failure reported); `tsc --noEmit` for `apps/api` passed earlier on the same code
  (after the test double fix), and the web `tsc` re-run was stopped.

## Review fixes (#4492 REVISE)

- **Revise keeps time fields.** F10 `reviseClaim` inserted the new claim with only `valid_from = now()`, so a done todo
  came back as open without its due date, and a 「这周」 claim became permanent. A BEFORE INSERT trigger
  (`kg_revise_inherits_time`) now copies `valid_to` / `due_at` and, for todo → todo, `todo_state` from
  `supersedes_claim_id` when the new row carries no time fields. `valid_from` is copied only when the old claim had a
  validity window (the window stays intact and `valid_from < valid_to` holds); otherwise it stays `now()`.
  The F17 card `editedStatement` path is unaffected: it creates a brand-new claim with no `supersedes_claim_id`.
  Test `time-dimension.test.ts` 「改写一条结论不丢时间字段」: with the fix 8/8 green
  (`fail-without-fix/api-revise-keeps-time.fixed.txt`); trigger dropped in the same DB ⇒ red, `todoStatus "open"`,
  `dueAt null` (`fail-without-fix/api-revise-keeps-time.txt`).
- Migration renamed to `20260928170000_kg_s6_time_dimension.sql` (after main's newest `20260928150000`; no clash with S4).
- The copy-inheritance "first source" check counts only active `derived_from` edges.
- Chat 「那个做完了」 is future work and is not wired (contract comment and this README reworded).

## Contract / signoff

Signed contract `packages/contracts/src/chat-knowledge-graph.ts` changed additively (optional `KgClaim.validUntil /
expired / todoStatus / dueAt`, `KgTodoStatus` + `KG_TODO_STATUS_LABEL_ZH`, optional `KgPersonalReplacedClaim.step /
replacedBy`, new op `setTodoStatus`). **Treated as approved, sign off later**: listed in
`evidence/phase-18/r10/README.md` §3.2.
