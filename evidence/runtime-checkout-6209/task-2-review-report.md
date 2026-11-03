CLEAN — spec compliance and code quality.

Reviewed exact 25832f6520b4d82625a5cc0c81393d9b7ca0b5ad..267252216b24575b7228fff401ade2d2d6e80da8 against task-2-brief.md, worker report, task-2-review.diff and updated evidence README.

The workflow delta changes only gates-test checkout inputs to fetch-depth: 1 and fetch-tags: false. It preserves the prior runtime fix, checkout version, default event SHA/ref selection, api-test-plan, other jobs, matrix/needs, timeout, commands, environment and cleanup. Parameterizing the existing regression covers both intended jobs without weakening the prior assertions. Other changes record the scope authorization and validation evidence.

The history audit addresses default test discovery and exclusions, subprocess callees and database support. The identified native-live Git command only resolves HEAD, which works with depth 1; this test is excluded from default shards. No evidence indicates a history/tag dependency. Recorded actual RED, selected GREEN, full queue checks and normalized whole-workflow comparison adequately validate this mechanical change. Native shard completion and recovered timing still require CI acceptance; the evidence does not claim otherwise.

No actionable P1/P2 findings. No tests, builds, browser, PostgreSQL or external actions run during review.
