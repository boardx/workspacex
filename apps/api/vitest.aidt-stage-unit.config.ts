import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["tests/aidt-stages/shared-stage*.test.ts"],environment:"node",maxWorkers:1,minWorkers:1,testTimeout:10000}});
