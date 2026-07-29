import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The gate tests shell out to node and boot a Nest app; the default 5s is too tight.
    testTimeout: 60_000,
  },
});
