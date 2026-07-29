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
  },
});
