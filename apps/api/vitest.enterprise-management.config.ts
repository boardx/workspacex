import {defineConfig} from "vitest/config";
export default defineConfig({test:{include:["tests/auth/platform-usage-boundaries.test.ts","tests/arch-gate.test.ts","tests/billing/enterprise-organization-summary.test.ts","tests/billing/enterprise-upgrade.test.ts","tests/billing/enterprise-no-paid-team.test.ts"],maxWorkers:1,minWorkers:1}});
