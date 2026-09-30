import { defineConfig } from "vitest/config";
/** Catalog adapter/failure tests own no DB; production probe is separately READ ONLY. */
export default defineConfig({ test: {
  include: ["apps/api/tests/deploy/bootstrap-compatibility.test.ts", "apps/api/tests/deploy/provision-admin.test.ts"],
  fileParallelism: false, maxWorkers: 1, minWorkers: 1,
} });
