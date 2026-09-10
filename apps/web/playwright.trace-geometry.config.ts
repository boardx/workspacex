import { defineConfig, devices } from "@playwright/test";

/**
 * issue #3205 —— 组件盒模型的几何门控，**不起应用**。
 * 被测对象是 `RunTracePanel` 的布局，真组件 + 真编译样式即可判定；
 * 挂 webServer 只会把一条 200ms 的断言变成 2 分钟且随负载假红。
 *
 * issue #3316 ① 的动效门控（`-liveness.spec.ts`）同属这一类：真组件 + 真编译样式，
 * 判的是「那枚图标是不是真的在转」。跟着这里跑，不另建第二个 config、不另开 CI 车道。
 */
export default defineConfig({
  outputDir: "test-results/trace-geometry",
  testDir: "./e2e",
  testMatch: /-(geometry|liveness)\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
