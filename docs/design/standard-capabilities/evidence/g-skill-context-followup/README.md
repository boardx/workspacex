# Context/web follow-up acceptance (#2934)

This opt-in lane adds five synthetic, real-model cases to the existing skill-batch harness. It reuses the production native graph, authorization controller, immutable skill packages, sandbox session, artifact staging, and database writeback. No new retrieval engine or sending capability is introduced.

The immutable snapshots are recorded in each `result.json`: `standard-context@1.1.0` or `standard-web@1.1.2`, the verified package digest, DashScope model ID, output SHA-256, and actual writeback status. `model-trace.json` retains tool calls and responses without credentials.

- `S001`: the same exact source/version is readable before project membership revocation and returns the generic 503 refusal afterward. The real-model artifact contains no revoked fact or stale citation.
- `S002`: two bounded fixture sources are actually fetched. Their texts conflict across release versions; the artifact retains both URLs, source IDs, content hashes, and conclusions.
- `S008`: search returns no authorized result. The artifact lists missing inputs and invents no person, status, or metric.
- `S011`: the current 1.1.0 package is read. The same revocation proof applies, the draft excludes revoked facts, and no send/task tool is invoked.
- `S014`: the current 1.1.0 package is read. `api-fixture.json` preserves the actual list/overview responses; the report matches Cedar's returned fields, marks absent metrics unknown, and treats null blueprint as unavailable.

Reproduce one case while holding the repository's isolated test slot and an owned sandbox:

```sh
source scripts/real-model-env.sh
real_model_load_env_file "$PWD"
WX_NATIVE_SANDBOX_CONTAINER=<owned-container> \
WX_SKILL_BATCH_CASE=<S001_REVOKED|S002_CONFLICT|S008_EMPTY|S011_REVOKED|S014_CURRENT> \
WX_SKILL_BATCH_EVIDENCE="$PWD/docs/design/standard-capabilities/evidence/g-skill-context-followup/<case>" \
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
pnpm --filter @repo/api exec vitest run --config vitest.skill-batch-real-model.config.ts
```

The ordinary test suite does not run this external-model lane. Provider or sandbox failures remain failures and are never replaced with a loopback model.
