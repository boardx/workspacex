import {defineConfig} from "vitest/config";
/** Warm-stack follow-up also exercises the real default seeded-tenant cleanup hook. */
export default defineConfig({test:{include:["tests/billing/enterprise-grant.pg.test.ts","tests/billing/enterprise-management.http.test.ts"],globalSetup:["tests/support/db-global-setup.ts"],setupFiles:["tests/support/db-file-cleanup.ts"],maxWorkers:1,minWorkers:1,testTimeout:30000,hookTimeout:180000}});
