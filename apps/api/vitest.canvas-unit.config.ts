import { defineConfig } from "vitest/config";

// These suites only exercise pure formatting/normalization functions; no SQL or app startup.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/canvas/normalize-fence*.test.ts",
      "tests/canvas/canvas-format-example.test.ts",
      "tests/agent-runtime/canvas-template-guidance.test.ts",
    ],
  },
});
