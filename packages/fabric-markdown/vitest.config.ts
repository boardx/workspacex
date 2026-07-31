import { defineConfig } from "vitest/config";

/**
 * 上游 `fabric-markdown` 的 164 个单测原样并入。
 * jsdom 是硬要求：mermaid 解析依赖 `getBBox` 做文本测量（ADR-100 §运行环境）。
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
