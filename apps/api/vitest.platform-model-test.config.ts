import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/model/platform-model-test*.test.ts"],maxWorkers:1,minWorkers:1}});
