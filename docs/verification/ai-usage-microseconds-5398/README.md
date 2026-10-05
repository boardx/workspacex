# AI usage microsecond snapshots (#5398)

Base: d4f15668ace9883fc6ce3a20ab87032a18ec4a9d. The existing 5121 checkout was explicitly assigned to this repair; no second worktree was created. Scope is the AI usage read cutoff, not research execution or auth/RLS policy.

CI background: PR #5395 run37314375134 job111777627680 failed the original native-usage summary assertion: expected callCount5/nativeCalls3, actual4/2, totalTokens15 unchanged. CI did not expose the missing receipt timestamp, so its specific timing is not claimed as independently recovered.

Independent deterministic real PostgreSQL RED used historical receipts at .123455Z, .123456Z and .123457Z, with inclusive asOf=.123456Z. The old repository returned .123Z and current callCount0/totalTokens0 instead of2/2; both summary and calls returned the truncated cutoff. No clocks, sleeps, random retries or altered native expected counts were used to prove this defect.

Fix: PostgreSQL clamps an optional asOf to transaction now and formats it as a UTC six-digit microsecond string. No JavaScript Date round trip is used for the cutoff. All queries keep their existing tenant scope, inclusive receipt cutoff, exclusive period end and exclusive cursor ordering.

Actual validation:
- RED: standard with-test-isolation wrapper, targeted ai-usage-repository microsecond snapshot test, exit1. Original assertion expected .123456Z, received .123Z; expected current count2/tokens2, received0/0.
- GREEN: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/auth/ai-usage-repository.test.ts --maxWorkers=1 --minWorkers=1`, exit0, 13 PASS. Includes original native3/calls5 assertion unchanged, microsecond summary-to-calls snapshot reuse/cursor pagination, default microsecond cutoff and future clamp.
- `./init.sh` quick installed-dependency path: exit0, not full-repository verification.
- `pnpm harness tick`: unavailable because COORD_GATEWAY_URL is unconfigured; no secret configuration was read. Readiness ran; this queue-external task repairs a required CI failure and a user-visible missing-usage defect as authorized by the coordinator.

Owned isolation projects wsx-fe25f1a930053ecbc7ea (first RED), wsx-4f2036e7cd5165b0a93e (full RED), and wsx-92985aa092835f6243a0 (GREEN) were managed/cleaned by the wrapper. GREEN PG20821 was independent of user/worker DB20704. Final container absence is checked separately before handoff. Raw machine logs are in /private/tmp/ai-usage-microsecond-{red,green,type,lint}.log; no user prompts/provider bodies or credentials were recorded in this evidence.

No production deployment, user database operation, external model call or automatic merge. Future cutoff precision above PostgreSQL's microsecond resolution is governed by PostgreSQL's timestamp input semantics.

Final local checks: API typecheck and API lint both exit0; git diff check exit0. All three owned compose projects returned no containers in `docker ps -a --filter label=com.docker.compose.project=<owned-project>` after testing.
