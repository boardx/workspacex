import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/billing/enterprise-upgrade.test.ts","tests/billing/enterprise-no-paid-team.test.ts"],maxWorkers:1,minWorkers:1}});
