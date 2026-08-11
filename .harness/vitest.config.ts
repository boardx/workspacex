import { defineConfig } from "vitest/config";

/**
 * 2026-08-12（#1010 续，#1017 的收尾）：.harness 此前没有 vitest 配置，吃默认
 * testTimeout=5000ms——而 fullstack-smoke.test.ts 的 spawn 就绪窗口每次尝试就是
 * 5 秒，#1017 加的「就绪超时重试一次」在默认预算下是**够不到的死代码**：第一次
 * 尝试超时的同一毫秒 vitest 杀掉整条测试（错误签名从「wrapper did not start」
 * 变成「Test timed out in 5000ms」，5003–5024ms，项目 Agent 实测定论）。
 *
 * 这不是「调大 5 秒常数」：就绪判据仍是每次尝试 5 秒（fullstack-smoke.test.ts），
 * 门的严格度不变，真「wrapper 起不来」两次都红；这里只是给挂钟留出两次尝试+收尸的预算；60s 对齐 apps/api 同因先例（「机器一有负载，10 秒的操作就接近超时」）——本套件 63 文件并行时自身就是负载源，20s 实测仍被压穿。apps/api（60s）/apps/web（15s）早有同款先例与同款注释。
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
