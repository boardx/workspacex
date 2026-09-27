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
in [`../r10/README.md`](../r10/README.md) §3.2. Migration `20260927470000_kg_s7_citation_corrections.sql` sorts after
origin/main's newest (`20260927310000`).

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

The stack came up: db `s7e2e` migrated (including `20260927470000`) and seeded, the API on 59143, the unmodified
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
