import { describe, expect, it } from "vitest";
import { progressState, STARTUP_STEPS } from "../src/startup-progress";

const S = (lines: string[]) => progressState(lines, { startedAt: Date.now(), failed: false });

describe("启动屏进度", () => {
  it("按日志前缀推进步骤", () => {
    expect(S(["[pglite] owner phase"]).current).toContain(STARTUP_STEPS[0]!.label);
    expect(S(["[pglite] x", "[api] listening"]).step).toBeGreaterThan(0);
  });

  it("正在拉模型时，台前显示的是百分比，不是一动不动的「检查本地模型…」", () => {
    const st = S([
      "[ollama] pulling qwen3.5:4b (first start only; several GB for the chat model)",
      "[ollama] 拉取 qwen3.5:4b 42%（1.3/3.1 GB）",
    ]);
    expect(st.current).toContain("42%");
    expect(st.current).not.toContain("检查本地模型");
    expect(st.hint).toContain("下载本地模型");
  });

  it("总是用最近一条进度，不是第一条", () => {
    const st = S([
      "[ollama] 拉取 m 10%（0.3/3.1 GB）",
      "[ollama] 拉取 m 88%（2.7/3.1 GB）",
    ]);
    expect(st.current).toContain("88%");
  });

  it("拉完之后回到正常的步骤文案，不把百分比一直挂着", () => {
    const st = S([
      "[ollama] 拉取 m 100%（3.1/3.1 GB）",
      "[ollama] 拉取 m 完成",
      "[api] listening",
    ]);
    expect(st.current).not.toContain("%");
    expect(st.current).toContain("启动服务");
  });

  it("失败时台前是「启动失败」，不被拉取进度盖过去", () => {
    const st = progressState(["[ollama] 拉取 m 42%（1.3/3.1 GB）"], { startedAt: Date.now(), failed: true });
    expect(st.current).toBe("启动失败");
  });

  it("没在拉模型时的提示照旧", () => {
    expect(S(["[pglite] x"]).hint).toContain("15–30 秒");
    expect(S(["[pglite] database created"]).hint).toContain("初始化数据库");
  });
});
