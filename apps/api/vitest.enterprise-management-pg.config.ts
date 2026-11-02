import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/billing/enterprise-grant.pg.test.ts"],maxWorkers:1,minWorkers:1,testTimeout:30000}});
