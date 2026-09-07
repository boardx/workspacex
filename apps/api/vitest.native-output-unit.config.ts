import { defineConfig } from "vitest/config";
/** Byte validation only: these tests never connect to a database. */
export default defineConfig({test:{include:["tests/agent-runtime/native-output-staging.test.ts"],maxWorkers:1,minWorkers:1}});
