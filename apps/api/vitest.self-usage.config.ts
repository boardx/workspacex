import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/auth/self-usage-cursor.test.ts"],maxWorkers:1,minWorkers:1}});
