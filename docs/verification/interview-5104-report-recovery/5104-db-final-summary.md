# #5104 final PostgreSQL recovery and execution regression

Base HEAD before/after2304fef0e87e3f037e0f0c4c9ce62c0cf669029d, branch codex/interview-report-quality-recovery, plus final uncommitted application changes including diagnostics reasonStage and recovery checkpoint context timing. Three application file hashes before/after identical (cmp exit0). Runner made no code edits, branch switch, worktree or commit during this final run.

Command:
```sh
node --import tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/itv/interview-report-recovery-db.test.ts tests/itv/interview-markdown-execution.test.ts --maxWorkers=1 --minWorkers=1
```
Raw log: /private/tmp/wsx-interview-5019-acceptance/5104-db-final-green.txt
Exit0; 2files16/16 tests passed, no skip: recovery6, execution10. Vitest75.63s, tests63.78s; resource admission25s, command1m18s, cleanup1s, total1m43s. No full baseline repeated.

Real isolated PostgreSQL repo/reader/execution/review paths, controlled model doubles with synthetic material; no external-model or real-participant claims. Recovery checks failed v1 exact bytes/hash/references/evidenceMode, full v2 draft replacement, per-save version increment, max2 calls, still-invalid failed output and blocked approval, one-call normal output, single-expert multi-answer simulation, and pre-second-call CAS/access recheck. Execution checks failure-gap retry, pause/persistence, claim deduplication, concurrency/overflow, expired claim rejection, permission and source-version boundaries.

Own isolation run-mur2d2i1-cebe301e-f11becf1b954, database wsx_f11becf1b95469614b40, compose wsx-f11becf1b95469614b40, pg20185. Wrapper cleanup succeeded. Exact compose-label Docker container and volume queries both returned empty after exit; no other stacks touched. Test process finished.

Before hashes:
```text
ea23ad1a96623055e3167ca75f992fa0f56e7d430f5b3b619072b30973de0e86  apps/api/src/application/interview/generate-interview-markdown.ts
573312c8b0ac2998b0a34f7957f5c08f3e9a4562a721b9bdcbf7ded1189e1cdc  apps/api/src/application/interview/workflow/interview-report-diagnostics.ts
a46111c8a8aaf1ffb29956aa359aff5785674b8a0ca71652c8d86b7fbd596f9a  apps/api/src/application/interview/workflow/interview-report-recovery.ts
```
After hashes:
```text
ea23ad1a96623055e3167ca75f992fa0f56e7d430f5b3b619072b30973de0e86  apps/api/src/application/interview/generate-interview-markdown.ts
573312c8b0ac2998b0a34f7957f5c08f3e9a4562a721b9bdcbf7ded1189e1cdc  apps/api/src/application/interview/workflow/interview-report-diagnostics.ts
a46111c8a8aaf1ffb29956aa359aff5785674b8a0ca71652c8d86b7fbd596f9a  apps/api/src/application/interview/workflow/interview-report-recovery.ts
```
