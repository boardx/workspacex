import { defineConfig } from "vitest/config";

/** Feedback application/fetch tests use in-memory ports only; persistence stays in the isolated DB lane. */
export default defineConfig({ test: {
  include: [
    "tests/feedback/github-issue-creator.test.ts",
    "tests/feedback/github-label-deadline.test.ts",
    "tests/feedback/triage-feedback.test.ts",
    "tests/feedback/draft-lifecycle.test.ts",
    "tests/design-workbench/create-design-github-issue.test.ts",
  ],
  maxWorkers: 1, minWorkers: 1,
} });
