import {defineConfig} from "vitest/config";
export default defineConfig({test:{globalSetup:["tests/support/db-global-setup.ts"],include:["tests/billing/enterprise-management.http.test.ts"],maxWorkers:1,minWorkers:1,testTimeout:30000,hookTimeout:180000}});
