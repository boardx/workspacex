import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
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
    env: { PGDATABASE: process.env.WORKSPACEX_DB ?? "workspacex" },
    // The gate tests shell out to node and boot a Nest app; the default 5s is too tight.
    testTimeout: 60_000,
    /**
     * Root cause of issue #74 (full-suite nondeterminism: single run green, back-to-back
     * runs red with a different failure set each time), found by measurement 2026-07-31:
     *
     *   Postgres max_connections = 100
     *   PgDatabase pool = { max: 5 } per instance, ~1 instance per integration test file
     *   81/124 files import tests/support/db (need Postgres); 42 of those call `new PgDatabase`
     *   Default vitest file parallelism on this 10-core host schedules ~10 files concurrently
     *
     *   ⇒ one full local run can open up to ~10 files × ~7 connections (pool + raw
     *   migration/app clients) ≈ 70 connections against a 100-connection ceiling, with no
     *   margin for teardown lag between files. That is a connection-count race, not "load" --
     *   it explains why the SAME command on an IDLE machine was measured to go
     *   green / red(49) / red(61) / red(22) / green / green across six consecutive runs.
     *
     * Capping the thread pool bounds worst-case concurrent connections to
     * ~4 files × ~7 ≈ 28, leaving headroom even if two CI runs' teardown/startup overlap.
     * This is NOT a workaround for slowness -- it is the fix for the nondeterminism itself.
     * Counter-proof: five consecutive full runs on an idle machine, all green (recorded in
     * issue #74's closing comment). If it goes red again, the cap is not the whole story.
     */
    poolOptions: {
      threads: {
        maxThreads: 4,
        minThreads: 1,
      },
    },
  },
});
