import { defineConfig } from "vitest/config";

/** HTML generation/editing pure ports; persistence is verified in the owned local stack. */
export default defineConfig({ test: {
  include: ["tests/design-workbench/html-page-generation.test.ts", "tests/design-workbench/design-chat-model.test.ts", "tests/design-workbench/merge-screens.test.ts", "tests/design-workbench/project-lifecycle.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
