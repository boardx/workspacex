# Scoped consensus grammar (#5330)

Dependency: #5301 (PR #5323). This independent change extends the scoped negative grammar only for using consensus as a basis (requiring the adjacent “的依据” suffix) and merged declaring/asserting consensus. The diagnostic contains exact public synthetic paragraphs rejected under integration 21a1fd317e43d494699f3e5b434c0cfa11ac223f. This does not identify the private devapp report's unknown failure cause.

TDD: three negative-form regressions failed before the change. Afterward grounding42/recovery19 (61 total) passed. Positive as-basis/merged claims, contrasts, double negation, denial of another denial, punctuation and newline boundaries remain rejected without trusted two-expert evidence. Exact quotes, server identities, source/version/hash and raw output rules remain unchanged. Independent exact review and combined public model semantic recheck still required.
