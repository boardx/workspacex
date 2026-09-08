import { defineConfig } from "vitest/config";
import base from "./vitest.config";

// #3052 —— 原生运行时车道。两个前置都不是"最好有"：没有真实沙箱会话容器，
// provision 落不到真实 UDS 上；没有 KERNEL_NATIVE_RUNTIME=1，这条车道就退化成
// 又一条与现有 lane 无差别的测试，而"没有任何车道开着这个变量"正是 #3052 本身。
// 与 vitest.native-document.config.ts 一样替换（不是 merge）include/exclude：
// mergeConfig 会把普通套件也选进来。
if (!process.env.WX_NATIVE_SANDBOX_CONTAINER) {
  throw new Error("native runtime lane requires an explicitly owned WX_NATIVE_SANDBOX_CONTAINER");
}
if (process.env.KERNEL_NATIVE_RUNTIME !== "1") {
  throw new Error("native runtime lane requires KERNEL_NATIVE_RUNTIME=1");
}
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/agent-runtime/native-runtime-lane.test.ts"],
    exclude: [],
    fileParallelism: false,
  },
});
