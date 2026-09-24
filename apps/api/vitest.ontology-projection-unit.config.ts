import { defineConfig } from "vitest/config";

/** D12 dev-process projection: pure mapping + contract/migration single-source check, no DB.
 *  The DB half is tests/retrieval/ontology-projection-migration.test.ts (isolated DB lane). */
export default defineConfig({ test: {
  include: ["tests/retrieval/ontology-projection-mapping.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
