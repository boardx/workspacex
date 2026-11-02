import {defineConfig} from "vitest/config";
/** Only the new retained-history boundary; existing regression coverage remains in CI. */
export default defineConfig({test:{include:["tests/billing/enterprise-grant.pg.test.ts"],testNamePattern:"owner tenant teardown preserves immutable financial history",globalSetup:["tests/support/db-global-setup.ts"],setupFiles:["tests/support/db-file-cleanup.ts"],maxWorkers:1,minWorkers:1,testTimeout:30000,hookTimeout:180000}});
