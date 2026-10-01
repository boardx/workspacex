import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
/** Catalog adapter/failure tests own no DB; production probe is separately READ ONLY. */
export default defineConfig({ root: fileURLToPath(new URL("../../", import.meta.url)), test: {
  include: ["apps/api/tests/deploy/bootstrap-compatibility.test.ts", "apps/api/tests/deploy/provision-admin.test.ts"],
  fileParallelism: false, maxWorkers: 1, minWorkers: 1,
} });
