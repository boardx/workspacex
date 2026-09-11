import { defineConfig } from "vitest/config";
// No global DB setup. PostgreSQL/RLS integration remains a separate explicit lane.
export default defineConfig({ test: { include: ["tests/files/cloud-*.test.ts",
  "tests/files/physical-delete-receipt.test.ts", "tests/files/export-manifest-sha256.test.ts",
  "tests/files/export-zip-tree-parity.test.ts", "tests/agent-runtime/collect-native-outputs.test.ts",
  "tests/rec/recording-upload-storage.test.ts"],
  exclude: ["**/*.real-db.test.ts"], maxWorkers: 1, minWorkers: 1, testTimeout: 15000 } });
