import { defineConfig } from "vitest/config";
/** Pure transport tests: no database or application bootstrap. */
export default defineConfig({test:{include:["tests/billing/team-wechat-checkout.test.ts","tests/billing/personal-wechat-payment.test.ts","tests/billing/native-read-deadline.test.ts"],maxWorkers:1,minWorkers:1,fileParallelism:false}});
