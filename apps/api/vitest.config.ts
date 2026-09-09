import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    /**
     * 2026-08-12（org-admin 线三组对照实验定位）：本文件的「migration 可重放」用例
     * 是 DDL 重放——PG 里 DDL 拿重量级锁，与几十个并行测试文件的事务必然互咬，
     * 完整套件下稳定 deadlock（单文件 4/4 绿、三目录 1348 绿、全量必红）。
     * 它是**设计上不能与他人并行**的用例：从并行池排除，由 package.json 的 test
     * 脚本在主套件后独占补跑（见 vitest.exclusive.config.ts）。#1068 的包间串行化
     * 解决的是跨包，解决不了包内——这条是那条修复的直接续作。
     */
    // Real native sandbox lane requires an explicitly owned container; see test:native-chain.
    // `native-runtime-lane.test.ts`（#3052）同理：它还额外要求 `KERNEL_NATIVE_RUNTIME=1`，
    // 普通 shard 抽到它只会红在"车道前置没有"上（PR #3112 首跑 shard 4 实测）。这三条
    // 的准入不靠 skip 靠这份 exclude——skip 会让"这条车道到底跑没跑"变成看不见的事，
    // 而 vitest.native-runtime-lane.config.ts 用 `exclude: []` 把它选回来，且在缺任一
    // 前置时**抛错**而不是跳过。
    exclude: ["tests/recording/personal-transcription-persistence.test.ts", "tests/agent-runtime/native-full-chain.test.ts", "tests/agent-runtime/standard-document-locators-http.test.ts", "tests/agent-runtime/native-runtime-lane.test.ts"],
    globalSetup: ["tests/support/db-global-setup.ts"],
    /**
     * WORKSPACEX_DB is how parallel workers avoid dropping each other's database, and
     * `scripts/lib.sh` translates it into PGDATABASE for the shell gates. Vitest had no
     * such translation, so `WORKSPACEX_DB=wsx_x pnpm exec vitest run` created a per-worker
     * database in `tests/support/db.ts` and then connected to the SHARED one -- the
     * isolation was documented, exercised, and not in effect.
     *
     * The symptom is the worst kind: nothing errors. Two workers simply share fixtures,
     * and assertions pass or fail according to who ran what a second earlier.
     */
    env: {
      PGDATABASE: process.env.WORKSPACEX_DB ?? "workspacex",
      /**
       * #548: the API process refuses to boot without this (see
       * `infrastructure/model/aes-credential-cipher.ts` -- a development fallback for an
       * encryption key is a production deployment that seals every customer's credentials
       * under a constant living in the git history). Every test file that calls
       * `createApp()` therefore needs one, and that is ~64 files, so it belongs HERE
       * rather than as a `process.env.X ??=` line repeated in each of them.
       *
       * ⚠ Not "the same fact in two places" with the playwright configs' own copies: an
       *   encryption key is per-environment BY DESIGN, and its VALUE is supposed to
       *   differ. What must never fork is the REQUIREMENT, and that is declared in
       *   exactly one place -- the cipher.
       */
      MODEL_CREDENTIAL_KEY: "vitest-key-548-not-a-production-secret",
      /**
       * 2026-09-09（agui-bridge 系列反复 30s 超时的根因之一）：中继（`agui-bridge.ts` /
       * `stream-run.ts`）的默认预算是 900s——为真实 devapp 的慢 run 定的，成立。但测试
       * 进程里每条用例自己的上限是 30s（真实耗时 0.5–1.1s）。两者相差 30 倍，后果不是
       * 「慢」而是**没有可诊断的失败**：run 一旦卡住，服务端按 900s 继续轮询、SSE 体不
       * 结束，测试里的 `await response.text()` 没有自己的 deadline，只能报一条什么都不
       * 说的 `Test timed out in 30000ms`，随后那条还开着的 socket 让 `app.close()` 再
       * 撞一条 `Hook timed out in 120000ms`，整个文件连同其余通过的用例一起红。
       *
       * 20s 这个值的依据是实测分布而不是拍脑袋：这一族每条用例本地实测 0.5–1.1s
       * （两次 POST 的跨轮用例 1.03–1.14s），20s 是 ~18 倍余量，且稳稳低于 30s 的用例
       * 上限——卡住时先到期的是中继自己的 `{ kind: "timeout" }` 分支，产出一条指名道姓
       * 的 RUN_ERROR 断言失败。
       *
       * ⚠ 这不是把超时调大来藏问题：生产默认值（`DEFAULT_RUN_MAX_POLLS`）一个字节没动，
       *   `poll-budget-covers-deep-agent-timeout.test.ts` 仍然钉着它盖过 deep-agent 预算。
       */
      KERNEL_RUN_RELAY_MAX_WAIT_MS: "20000",
    },
    // The gate tests shell out to node and boot a Nest app; the default 5s is too tight.
    testTimeout: 60_000,
    /**
     * #76: `hookTimeout` was never set, so it stayed at vitest's default 10s. Every
     * connected-DB test's `beforeAll` does docker liveness probing + replays every migration
     * (49 files and climbing, see apps/api/migrations/) + its own fixture seeding -- nowhere
     * near a 10s operation once the machine has any load on it. `testTimeout` was already
     * raised to 60s for the same reason ("boots a Nest app"); the hook that runs BEFORE any
     * test body is heavier than that and was left at 1/6th the budget.
     *
     * Why this matters more than "slow": the failure mode is a MISLEADING one. A hook
     * timeout reports as `Test Files 1 failed (1)` / `Tests N skipped (N)` -- which reads as
     * "could not collect this file" (a real prior incident here: `.tsx` missing from
     * `include`), not as "ran out of time". On a loaded machine this turned a whole file's
     * worth of real, passing tests into a false failure with a misdiagnosable error shape.
     */
    hookTimeout: 120_000,
    /**
     * Attempted fix for issue #74 (full-suite nondeterminism: single run green, back-to-back
     * runs red with a different failure set each time). The hypothesis this was built on:
     * concurrent test files racing Postgres's max_connections=100 ceiling.
     *
     * ⚠ MEASURED NOT TO WORK, on its own: five consecutive full runs after adding this cap
     * still hit 81/124 files failing on the second run (see commit 5c2c196's message -- the
     * honest record; do not trust a comment over `git log -- <this file>`). #74 is still
     * OPEN. The cap is kept because it is harmless and does lower worst-case concurrent
     * connections, but it is not proof of anything and must not be read as one.
     *
     * The most likely remaining direct cause is the hookTimeout gap fixed above -- #74's own
     * body flags it as "should verify first" and it had never actually been tried before now.
     * See #74 for the actual verification (repeated-run evidence), not this comment.
     */
    // Vitest 2 defaults to the `forks` pool. The old poolOptions.threads limit therefore
    // constrained a pool we never used and left the real fork count at available CPUs.
    // `maxWorkers` applies to the active pool and keeps the PostgreSQL budget mechanical.
    //
    // 2026-08-12（项目 Agent 定位，直接续 #1068/#1090）：maxWorkers=4 让本包 4 个 fork
    // 并行打同一张共享库，撞见的是真锁序死锁，不是连接数问题——`kernel_apply_org_freeze_
    // policies()` 的 `DROP POLICY` 要表级 AccessExclusiveLock，与另一个 worker 正持的
    // 行锁互等成环（rbac-role-matrix / rls-cross-tenant-zero-leak / personal-transcription-
    // persistence 三个文件轮流中枪，同一份代码两轮红的文件都不同，是并发争用的确定特征）。
    // 单独 exclude 一个文件（见上）治不了这个：任何两个 DDL/RLS 重的文件同时抽到不同
    // worker 就会撞。降到 1 worker 先止血——「谁跑 verify 谁随机中枪」比慢更糟；把
    // DDL/RLS 类测试分组保持并行是后续优化，不在本次止血范围内。
    maxWorkers: 1,
    minWorkers: 1,
  },
});
