import { defineConfig } from "vitest/config";
/** Raw-file application and transport checks; real PG/browser evidence is a separate lane. */
export default defineConfig({test:{include:["tests/aidt-files/*-unit.test.ts","tests/aidt-files/*-controller.test.ts"],environment:"node",fileParallelism:false,maxWorkers:1,minWorkers:1,testTimeout:10000}});
