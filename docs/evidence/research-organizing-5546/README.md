# #5546 review package — not accepted as complete

The configured model provider returned exact HTTP 400 / data_inspection_failed on a bounded local replay. Previously this became generic workflow failure. The repair isolates only exact content-rejected source/evidence request batches, keeps valid evidence, records safe rejection metadata and reuses only identical actual request/model-instance bases. Main-question coverage and per-question direct/context repair feedback are explicit; quality/citation gates are unchanged.

Final real local replay **failed formal-report acceptance**: first 269.603s / 25 calls / four draft chapters / one quality warning; regeneration 231.740s / 19 additional calls / four draft chapters / three warnings. Both durable snapshots originally reread successfully. The first full-runtime file was later overwritten by an accidental unconfigured script check; its exact draft/history is retained in the untouched regeneration snapshot. See the evidence-handling correction. The consciously reduced seven-source partial fixture is not the captured 23-source nonpartial devapp session. There is no claim of full online recovery or a guarantee that every generation succeeds.

Validation: 32 research files / 715 tests passed; 12 Web report tests passed; API/Web/contracts typecheck, API lint and affected Web ESLint passed. Legacy persisted/public runtimes with absent rejection fields and old invalid_model_evidence warnings remain readable. init quick passed. Mandatory verify:release exited 1 at five unchanged files' pre-existing oss-secret-scan baseline failures, before full repository tests. No baseline or unrelated file was changed.

- [Investigation and boundaries](investigation.md)
- [Final model metadata log](final-real-replay.txt)
- [Independent per-generation results and warnings](final-real-results.json)
- [Release gate log](verify-release.txt)
- [Handoff](session-handoff.md)

## Bounded local reproduction

Run from repository root; use the existing approved model environment in a child shell. This reads public pages and calls the real model, capped at 60 calls. It writes private local runtime snapshots under /tmp, without storing credentials. It does not read or mutate the devapp database.

```bash
source scripts/real-model-env.sh
WORKSPACEX_ENV_FILE=/path/to/approved/model.env real_model_load_env_file "$PWD"
pnpm --filter @repo/api exec tsx ../../docs/evidence/research-organizing-5546/replay/read.ts
pnpm --filter @repo/api exec tsx ../../docs/evidence/research-organizing-5546/replay/report.ts
```

The report replay exits 1 unless both generations produce formal reports without drafts/quality warnings. Source pages may change; fixture hash comparisons expose that difference. The completed final run is archived above; do not rerun without the main session's next evidence decision.

Offline full-fixture follow-up: see [full-fixture-feasibility.md](full-fixture-feasibility.md). Original approvals skip screening; prior seven-source partial replay is not equivalent. Test/evidence-only follow-up passes 717 unit tests and preserves same-source healthy chunks after a batch refusal. Full original runtime export remains unavailable. No acceptance or release claim.
