# #4271 round 3 — 「我决定关注 211 高校」 in a real browser, real local stack

Stack (no Docker): local Postgres 16 + AGE + pgvector (db `r03`), `redis-server`, `apps/api` (`tsx src/main.ts`),
`apps/web` (`next dev`, same-origin proxy `/__fullstack_api`), Chromium from `/opt/pw-browsers`.

Model: `apps/api/scripts/loopback-kg-eval-model-provider.ts` (the F15 eval loopback) fed `harness/cases-r03.json`.
**Substitute, labelled:** extraction of exactly 「我决定关注 211 高校」 returns one `decision` claim because the
corpus says so (the loopback plays "an extraction model that read the sentence right"); everything downstream is the
product path. Chat answers only echo the 【记忆】 block the executor actually sent, so an answer containing the
decision proves it was in the model's context. Seed: `scripts/seed-kg-experience-eval.ts` (owner account only),
then the explicit `enabled=false` org row that `seedOrg` writes for test orgs was deleted to restore the product
default (no row = on).

- `journey.json` — ids, chip text, thread knowledge, per-turn `getTurnMemory.recalled`, personal space, /brain data
- `db-proof.txt` — gates, claims (scope / revoked), claim → human message evidence, `kg_turn_recalls`, memory cards
- `harness/` — the Playwright spec + config used (run from `apps/web` against the running stack)
- `NN-*.png` — one or more screenshots per step; `4247-*.png` — the #4247 deployment-switch check
