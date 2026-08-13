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
    exclude: ["tests/recording/personal-transcription-persistence.test.ts"],
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
    maxWorkers: 4,
    minWorkers: 1,
  },
});
