# Round S7 — #4364: answers cite the memories they used, and the owner corrects them on the spot

Branch `s7` from origin/main `5f0b835a0`. Epic #4359, round S7.

## Design

- **Which memories become chips.** `domain/knowledge-graph/citation.ts` `reconcileCitations(answer, recalled)` runs on
  the server. It takes the answer text and the **recall set of that exact turn** (`kg_turn_recalls.items`, as the
  executor wrote it, after the per-viewer filter in `readTurnRecall`). It returns the ids the answer actually used.
  "Used" is a deterministic lexical check: CJK bigrams plus ASCII words, where the answer covers at least 50% of the
  statement's units and at least 2 of them. The result is always a subset of `recalled`, so a claim the model mentions
  but that was not recalled can never become a chip. `getTurnMemory.cited` carries it. The web draws chips only from
  `cited`, and 「为什么用到它」 still lists the whole recall set.
- **The chip.** It reads 「依据你 9/20 的决定」 (`[n] 依据你 {M/D} 的` + the kind). Personal items say 「依据你的…」 because
  the date is already on the 「来自你 M/D 的对话」 badge. Clicking a chip still opens the source drawer (F13/E4
  unchanged), and it also expands the claim in place (`CitationDetail`) with the full statement and 「跳到原消息」, which
  reuses the R6/F15 jump (`threadOfClaimSource` + `highlightChatMessage` / `focusMessageHref`).
- **Corrections (owner only, and only on a turn the owner asked).**
  - 「这条不对」 asks 「正确的是？（可不填）」.
    - Left empty, it shows the F17 **forget card** (`MemoryCard`, listing only this claim); 忘掉 → forget.
    - With a replacement typed, it shows the #4290 **supersede card** (`ConflictPromptCard` `possible_change`:
      「用〈新〉取代〈旧〉？」); 取代 → supersede; 两条都保留 → no change.
  - 「已过时」 → `ClaimExpiryPort.expireClaim`. **TODO(#4363):** S6's `valid_until` is not on main, so `expireClaim` is
    wired to the existing revoke (`revocation_reason = user_citation_expired`). S6 swaps the implementation behind the
    same port and name.
  - All three go through `correctCitation`:
    1. The app layer checks that the thread is visible, the caller is the owner, and the claim is in this turn's
       server-reconciled `cited`; otherwise it returns `KG_CLAIM_NOT_FOUND`.
    2. `kg_correct_citation` (a SECURITY DEFINER function) re-checks the owner, the turn's requester, recall-set
       membership, liveness and scope. It then revokes the claim, or supersedes it the way `reviseClaim` does (evidence
       and edges move to the new claim, except `derived_from`).
    3. It audits in `ontology_actions` and writes a `kg_citation_corrections` row.
- **Correction rate.** `getCitationMetrics` (`GET /knowledge-graph/me/citation-metrics`) returns
  `correctionRate = corrections / citedUses` over 30 days, and `null` when there are no cited uses.
  - `citedUses` is recomputed with the same `reconcileCitations` over the requester's own answers, so chips and metric
    share one judgement. `corrections` is counted from `kg_citation_corrections`.
  - It is guarded on the viewer's personal space.
  - **Golden set / north-star notes:** no such folder exists on origin/main (S3's #4360 skeleton has not landed), so
    nothing was written there. The endpoint is the signal to wire in when it lands.
- **Next turn.** Forgotten and expired claims are revoked, and superseded ones become `superseded`, so the recall
  candidate query (`LIVE`) never returns them again. A revoked personal copy also keeps its origin-thread claim out of
  F15 cross-thread recall, because the `derived_from` edge still exists.

## Contract (treated as approved, sign off later)

`KgTurnMemory.cited` (optional), `KgCitationCorrectionKind`, `correctCitation`, `getCitationMetrics`. These are listed
in [`../r10/README.md`](../r10/README.md) §3.2. Migration `20260928190000_kg_s7_citation_corrections.sql` sorts after
origin/main's newest (`20260928150000`, after merging main on the review round).

## Tests

| Suite | What it proves |
|---|---|
| `apps/api/tests/knowledge-graph/citation-reconcile.test.ts` (6) | Paraphrase with kept keywords ⇒ used. **A claim that was not recalled never appears.** Recalled but unused ⇒ no chip. Short statements need the whole sentence. Rate is null without cited uses. |
| `apps/api/tests/retrieval/kg-s7-citation-correction.test.ts` (9, real Postgres + AGE) | **Chip = recall set ∩ used**: the answer mentions a real claim from another thread and an invented one, and neither becomes a chip. Recalled-but-unused ⇒ no chip. **Authz**: another user ⇒ `KG_THREAD_NOT_FOUND`; a project member who is not the owner ⇒ `KG_NOT_OWNER`; the owner correcting another requester's turn ⇒ `KG_CLAIM_NOT_FOUND` (checked by the DB); a non-cited claim ⇒ `KG_CLAIM_NOT_FOUND`, even when the DB function is called directly. **Next turn**: real `knowledgeMemoryFor` no longer uses the claim after forget / supersede / expire (supersede recalls the new wording). **Metrics** count 7 cited uses and 2 wrong + 1 expired, and are per user. |
| `apps/web/tests/knowledge/citation-correction.test.tsx` (12) | Chips only from `cited` (an invented id is not drawn). 「依据你 M/D 的决定」. Click expands and jumps (and says so honestly when there is no source). No correction entry for non-owners. The forget card and the supersede card act only on confirmation. 「已过时」 shows its error and recovers. The TurnMemoryLine wiring POSTs `{kind: expired}`. |
| `apps/web/tests/knowledge/answer-memory-citations.test.tsx` | Existing F13 suite. One expectation was updated for the chip's new 「依据你的」 prefix. |

Fail-without-fix: [`fail-without-fix-api.txt`](fail-without-fix-api.txt) and
[`fail-without-fix-web.txt`](fail-without-fix-web.txt).

Results:

- API: 15/15 for the two new suites. The broad `tests/knowledge-graph` + `tests/retrieval` run (s7t) passed every
  suite that reads turn memory: `kg-turn-recall-citations`, `e2e-north-star-recall`, `personal-memory-project-thread`,
  `memory-card`, `conflict-prompt`, `goal-preference-personal-memory` and 36 others. It had failures only in
  `kg-hnsw-permission-recall` (1: an HNSW recall timing, 1562 s under load), `age-projection-worker` (3: AGE lock /
  timeout timing, up to 1210 s per test) and `cross-account-personal-memory-404` (4 skipped: its `beforeAll` timed
  out). None of those touch the changed files. The run was stopped at 45 files to free memory.
- Web: 29/29 (`citation-correction` + `answer-memory-citations`).
- `apps/api` `tsc --noEmit` and `pnpm lint` pass. `lint-contract-source`, `lint-contract-route-coverage` (ratchet: no new
  gap), `lint-body-path-param-leak`, `lint-e2e-testid-gate`, `lint-contract-negative-assertion` and
  `lint-contract-state-names` pass.

## Real browser — NOT completed (environment), harness ready

The journey is written and committed: [`harness/journey.spec.ts.txt`](harness/journey.spec.ts.txt), with
`playwright.s7.config.ts.txt`, `stack.sh.txt`, `env.sh.txt` and `cases-s7.json`. It covers, in order:

- 0: two own decisions in thread A;
- 1: the chip in a new thread B, where every chip is in `recalled` and 「依据你的决定」;
- 2: click → expand → 「跳到原消息」 lands in A with the source highlighted;
- 3: 这条不对 → forget card → 忘掉;
- 4: 已过时;
- 5: the same question in the next turn no longer uses either memory, no chip, the earlier answer's `cited` is empty,
  and metrics show wrong 1 / expired 1;
- privacy: another member gets 403/404.

The stack came up: db `s7e2e` migrated (including `20260928190000`) and seeded, the API on 59143, the unmodified
loopback on 59142, and redis on 59145. The web never served `/chat`:

1. Attempt 1: `next dev` compiled `/login` in 47 s. The `/chat` compile then outlasted the 180 s navigation timeout, and
   the first test failed on `page.goto('/chat')` ([`harness/playwright-run-attempt1.txt`](harness/playwright-run-attempt1.txt)).
   The same `next-server` was later OOM-killed by the shared memory cgroup (`dmesg`: `Memory cgroup out of memory:
   Killed process 7802 (next-server)`).
2. Attempt 2 hung in `npx` startup.
3. Attempt 3 compiled `/login` in 46 s and then spent more than 2 h 20 min on `Compiling /chat ...`, mostly in D
   state ([`harness/next-dev-attempt3.txt`](harness/next-dev-attempt3.txt)).

During all three attempts the machine's load average was 100–155 and memory 14/15 GB, with 5–6 other agents' `next dev`
servers in the same cgroup. The run needs a quieter machine: `stack.sh createdb migrate seed redis model api web`, copy
the two `.txt` files into `apps/web`, then `stack.sh pw`.

All stacks were stopped and the temporary databases (`s7e2e`, `s7t`, `s7tnomig`) were dropped. The temporary spec,
config and `.next-kg-eval` were removed, and the `tsconfig.json` include that `next dev` adds was reverted.

## Review round (PR #4490 at 46aa93289 → REVISE)

This round merged origin/main first. The migration was renamed `20260927470000` → `20260928190000` (slot assigned by the coordinator) so it still sorts
after main's newest (`20260928150000`).

- **F1 — correcting a claim corrects its whole family.** `kg_correct_citation` now gathers a "family": the clicked claim
  plus every live claim linked to it through **active `derived_from` edges**, in both directions and transitively.
  Only claims the owner may correct are included: this thread's, their own personal space, and their own other
  personal threads. Project memory (L2) is deliberately left out; it belongs to all members.
  - Forget and expire apply to the whole family.
  - A correction with new wording creates **one** new claim. It goes into the personal space if the family has a
    personal copy (so every thread recalls it), otherwise into the clicked claim's scope. It supersedes the family
    member in the same scope (the anchor, which becomes `superseded` like `reviseClaim`), and the rest of the family is
    revoked.
  - All involved scopes are locked in a fixed order (sessions before personal), and each touched scope gets its own
    audit row.
  - Regression tests (`kg-s7-citation-correction.test.ts`, describe 「S7 review F1」) use a real thread claim plus
    a derived personal copy and cover both directions: correcting the thread claim, and correcting the personal copy.
    Each checks that the old wording is live nowhere, the new wording exists exactly once, and the next turn in both
    threads recalls only the new wording, once. They also cover forget and expire across the family.
- **F2 — `derived_from` is not carried over; evidence is kept.** No `derived_from` edge goes to the new claim (a test
  checks this). **Decision: keep the evidence.** The family's evidence messages are copied onto the new claim with
  duplicates removed. The wording changed, not where the fact came from (same as F10 `reviseClaim`, I-5). Also, a
  personal-space claim can only be opened in the source drawer, or jumped from to the source message, through its
  evidence threads; without evidence the new claim would be a citation nobody can open. The fact that a person
  corrected it is recorded in `ontology_actions` (`via = citation`, with both claim ids).
- **F3 — citations: no more false positives on sibling claims.** Changes in `reconcileCitations` / `answerUsesStatement`:
  - A single Chinese character no longer counts as a match unit.
  - Every number in the claim must appear in the answer.
  - Negation must match: a negated claim needs its negation in the answer, and an answer that turns 「用」 into 「不用」
    does not count.
  - Siblings: when two recalled claims share at least 50% of their units, each needs one of its **own** units in the
    answer (a number, a name, a negation…).
  - Regression tests cover all four reported pairs (date, amount, name, negation in both directions), the both-used
    case, the no-sibling number and negation cases, and the single-character case.
- **F4 (interim) — 「已过时」 now asks for confirmation** (「确认这条已经过时？」 then 确认 / 取消). Rewriting it as
  `valid_to = now()`, and copying `valid_to` / `due_at` / `todo_state` on supersede, waits for S6 (#4492) to reach
  main. `TODO(#4363)` markers are at both places in the migration.
- **F6 — buttons only for people the server will accept.** `getTurnMemory.canCorrect` (optional, part of the
  sign-off-later contract list) is true only when the viewer owns the thread **and** asked this turn, which is the
  same rule `kg_correct_citation` enforces. Every cited claim is already in a scope that viewer can correct, because
  `recalled` is filtered per viewer. The web shows 「这条不对」 / 「已过时」 only when `canEdit && canCorrect`.
- **F5** (golden-set wiring, browser journey): follow-ups, handled by the coordinator.

Results: API 26/26 (`citation-reconcile` 14 + `kg-s7-citation-correction` 12); web 30/30 (`citation-correction` 13 +
`answer-memory-citations` 17). Fail-without-fix for each fix: [`fail-without-fix-review.txt`](fail-without-fix-review.txt).

## Delta review (PR #4490 at 36871e76b → REVISE)

- **D1 (security, blocking): no temp table.** `kg_correct_citation` (SECURITY DEFINER) no longer creates
  `pg_temp.kg_s7_family`. The family is kept in a `text[]` variable filled by a recursive CTE. A test checks that the
  function is still SECURITY DEFINER and that its source contains no `temp table`.
- **L1: the family walk only passes through owner-correctable claims.** The recursive term itself requires the next
  claim to be live and in this thread, the owner's personal space, or the owner's other personal threads. Project/org
  memory and other users' claims are never collected and never walked through.
  - Negative test: an L2 copy of the thread claim, another user's copy hanging off that L2 copy, and one of the owner's
    own personal claims reachable only via L2. After 「这条不对」, all three stay live.
- **L4: the anchor stays superseded, not revoked.** `derived_from` edges between family members are invalidated before
  any claim changes. The anchor (the owner's personal copy) therefore stays `superseded` with `revoked_at` NULL, so it
  remains available as supersede history, while the thread claim is revoked. The test asserts both claims' states and
  that the edge is invalidated.
- **L5: contract comment fixed, and the web gates on scope too.** The `canCorrect` comment no longer claims every cited
  claim is correctable. It now says `canCorrect` is per turn, and correctability also depends on the claim's scope.
  New constant `CITATION_CORRECTABLE_SCOPES` (`chat_session`, `personal`). The footer offers 「这条不对」 / 「已过时」
  only for those scopes, so if L2/L3 ever show up in `recalled` they get no buttons the server would reject. Web test
  included.
- **F4:** unchanged (confirmation step); waiting for S6.

Results: API 28/28, web 31/31. Fail-without-fix: [`fail-without-fix-delta.txt`](fail-without-fix-delta.txt)
(migration as at 36871e76b → 3 fail, footer as at 36871e76b → 1 fail; restored → all pass).

## F4 follow-up — 「已过时」 now sets `valid_to` instead of revoking (after S6 #4492 reached main)

- **New migration `20260928220000_kg_s7_f4_expire_valid_to.sql`** (sorts after main's newest, `20260928200000`). It
  replaces only `kg_correct_citation`. The already-applied `20260928190000` is **byte-identical to main**; its
  `TODO(#4363)` comments stay. `data-readiness.ts` compares each migration's sha256 with `_kernel_migrations.checksum`,
  so editing an applied file would leave every existing DB "schema not current". The new migration's header explains
  this (review B1).
  - **「已过时」 no longer revokes.** It sets `valid_to = now()` on the cited claim's whole family, the same family
    「这条不对」 uses. The claims are not revoked and their edges are untouched.
  - An already-expired claim ⇒ `KG_CLAIM_NOT_FOUND`, so no duplicate correction event is recorded.
  - If `valid_from` is in the future, it is pulled back to `now() - 1µs` and `valid_to = now()`, so the claim really
    expires now (review M1; the first version set `valid_to = valid_from + 1µs`, which kept it recalled and let
    repeated clicks through).
  - S10 project copies expire too (review M2; human decision 2026-09-28). The predicate is the one
    `kg_cascade_personal_share` uses: the copy has a `derived_from` edge into the family and no other live
    `derived_from` source. Project members stop recalling it.
  - The audit `payload.claims` lists only the claims this call actually expired, captured with `RETURNING`
    (review L1).
  - Audit `action_type = expireClaim`.
  - The next turn no longer recalls it (S6 `claimExpired` in recall), and `/brain` still lists it marked `expired`
    (「已过期」).
- **The 「这条不对」 replacement carries over `valid_to` / `due_at` / `todo_state`.** S6's `kg_revise_inherits_time_trg`
  already does this, because the new row has `supersedes_claim_id` and no time fields of its own. So there is **no
  new code, only a test**: a `todo` claim marked done, with a due date and a validity window, is corrected, and the
  replacement ends up with the same `todo_state` / `due_at` / `valid_to`.
- Tests (`kg-s7-citation-correction.test.ts`) check:
  - after 「已过时」 the claim is not revoked, `revocation_reason` is null, `status` is still accepted, and it is expired;
  - the next turn does not recall it, and `getPersonalKnowledge` shows `expired: true`;
  - a second 「已过时」 is rejected without recording another correction event;
  - the whole family is expired, not revoked, and the `derived_from` edge stays active;
  - the replacement inherits the time fields;
  - the correction metrics still count it (13 cited uses, wrong 7, expired 2).
- There is no "undo expire" operation on main, so nothing was added for it. The undo that sits next to these
  corrections (#4290 undo-supersede) goes through `kg_undo_supersede` and is not touched by this change.
- Results: API 29/29, web 31/31. Fail-without-fix is in [`fail-without-fix-f4.txt`](fail-without-fix-f4.txt): on a
  fresh DB without the new migration, 2 tests fail (the expire test and the family-expire test); restored, 29/29.
  The inherit-time test passes either way, as expected, because S6 already provides that behaviour; it is a regression
  guard only.
- **Review round of PR #4507** (d1c18454e → REVISE): B1, M1, M2, L1 and L2 are fixed.
  - New DB tests:
    - M1: a claim with a future validity window is expired by one click and not recalled on the next turn; a second
      click is rejected and records no extra correction row.
    - M2: after expiring the personal claim, a project member no longer recalls the S10 copy; the copy is expired,
      not revoked.
    - L1: an audit row covers only the claims this call newly expired, including the project scope.
    - L2: when the personal copy is the anchor, the replacement inherits `valid_to` / `due_at` / `todo_state`.
  - Fail-without-fix: [`fail-without-fix-f4-review.txt`](fail-without-fix-f4-review.txt). With the F4 migration as at
    d1c18454e, M1 and M2 fail (2 tests); restored, 18/18.
  - Also run: `share-personal-to-project` 13/13, `time-dimension` 8/8, `citation-reconcile` 14/14, api `tsc` and
    `pnpm lint` clean.
  - M3 (S8 consolidation ignores `valid_to`) is a separate issue.
- **Second review round** (3bc5845b2 → REVISE, N1 blocking):
  - **N1:** the project step now only follows `derived_from` edges whose destination is a family member in
    **v_user's personal space**; the project-lock query uses the same rule. So 「已过时」 on a session claim in a
    project thread no longer expires R7-promoted project claims, including a colleague's claim used as an R7 merge
    target, and writes no project-scope audit row.
  - **L3:** the "another live source" check now excludes the whole family (`v_family`), not just the claims touched
    this time.
  - New DB test N1: the session claim expires; the R7 copy and the colleague's merge target stay live; zero project
    audit rows.
  - Fail-without-fix: [`fail-without-fix-f4-n1.txt`](fail-without-fix-f4-n1.txt). With the migration as at 3bc5845b2,
    N1 fails; restored, 19/19.
  - Also run: `share-personal-to-project` 13/13, `promote-to-project` 5/5, `promote-to-org` 5/5, api `tsc` and
    `pnpm lint` clean.
- Environment note: after the host rebooted, the shared dev Postgres on 55432 (`/var/tmp/pgpurge/data`) was down.
  It was restarted through a manual-start `pg_ctlcluster` registration (`/etc/postgresql/16/pgpurge`, same data dir
  and options). The temporary DBs `s7f4` and `s7f4nomig` were dropped.
