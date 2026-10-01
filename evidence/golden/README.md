# Golden set — "never re-state known background" (issue #4360, skeleton)

North star (phase 18, epic #4359): **in a new chat session the user never has to re-state background the product
already knows.** This directory is the skeleton of the devapp golden set that checks it. It is separate from the frozen
F15 experience eval (`apps/web/e2e/kg-experience-eval/`, rubric-hashed); nothing here is in that rubric.

## Files

| File | What |
|------|------|
| `cases.json` | The golden journeys (`cases`) plus the loopback stand-in replies (`says` for extraction, `goalLinks` for the goal-link question). One file, so a case and the model behaviour it assumes cannot drift apart. |
| `../phase-18/s5/harness/journey.spec.ts.txt` | The browser runner for G001 / G002 (Playwright, real stack). Copied to `apps/web/e2e/s5/` for a run, same as the r11a harness. |
| `apps/api/scripts/north-star-restate-rate.ts` | The north-star metric: share of new personal sessions whose first message re-states known background, plus briefing shown / accepted / dismissed counts. Definition: `apps/api/src/domain/knowledge-graph/north-star.ts`. |
| `apps/api/scripts/loopback-golden-model-provider.ts` | Loopback for the goal-link question; forwards everything else to the unmodified F15 loopback. |

## Cases

- **G001** (#4360): say 「我的目标是探索未来教育」 in one chat → in a new chat, 「帮我规划」's answer uses the goal (recalled from
  the personal space, `kind = goal`), and the user did not re-state it (north-star sample `restated = false`).
- **G002** (#4362): a decision (auto-linked under the goal only because the goal-link proposal is high-confidence) and a
  todo → a new chat's opening briefing lists the goal, the decision (「为了：goal」) and the todo → 「续上」 the todo →
  the answer uses it and cites the same claim.

## Running it on loopback

Same stack shape as `evidence/phase-18/r11a/harness/` (own Postgres + AGE db, own redis, API via `tsx`, `next dev`,
Chromium from `/opt/pw-browsers`). The exact commands for round S5 are in `evidence/phase-18/s5/harness/stack.sh.txt`:

```
stack.sh createdb && stack.sh seed        # migrate + seed the F15 eval org (4 accounts, one agent)
stack.sh redis & stack.sh model & stack.sh golden & stack.sh api & stack.sh web &
stack.sh pw                               # the journey (G001 + G002 + S5 checks)
stack.sh northstar                        # north-star.json
stack.sh dropdb
```

`LOOPBACK_KG_EVAL_CASES` and `LOOPBACK_GOLDEN_CASES` both point at `cases.json`. The F15 loopback reads only `says`.

## On devapp (next step, not done here)

Replace the loopback with the deployed model (`KERNEL_MODEL_PROVIDER` / `KERNEL_MODEL_BASE_URL`), drop `says` /
`goalLinks`, run the same journeys, and run `north-star-restate-rate.ts --org <org> --since <date>` against the devapp
database to track the rate over time. Add a case per real re-statement found in devapp transcripts.
