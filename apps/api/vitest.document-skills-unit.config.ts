import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["tests/skill/office-finite-editing.test.ts"],environment:"node",fileParallelism:false}});
