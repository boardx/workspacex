import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
/** Unit lane intentionally does not create or connect a database. */
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: { include: ["apps/api/tests/project-member-chat/*-service.test.ts", "apps/api/tests/project-member-chat/*-controller.test.ts"],
    fileParallelism: false, maxWorkers: 1, minWorkers: 1 },
});
