import {defineConfig} from "vitest/config";
/** Pure tests only. Real PostgreSQL provenance/immutability tests run in normal CI. */
export default defineConfig({test:{include:[
 "tests/model/platform-model-test*.test.ts","tests/model/platform-test*.test.ts",
 "tests/model/pg-platform-model-test-repository.test.ts","tests/model/org-core-model-snapshot.test.ts",
 "tests/auth/ai-context-runtime-wiring.test.ts","tests/auth/platform-usage-boundaries.test.ts",
 "tests/model/core-model-runtime-guard.test.ts","tests/auth/ai-native-ledger.test.ts","tests/auth/stage-two-native-partial-settlement.test.ts",
 "tests/auth/platform-model-test-boundaries.test.ts","tests/auth/org-core-model*.test.ts",
],maxWorkers:1,minWorkers:1}});
