/**
 * issue #1493 —— 纯函数单测：`buildCanvasTemplateGuidance` 的拼接与空清单行为，
 * `buildSystemPrompt` 新增的可选第三参数不破坏既有调用点（不传 = 逐字节不变）。
 * 真栈（读库 + 现查 + 不缓存 + 个人对话）由
 * `tests/agent-runtime/canvas-template-guidance-real-db.test.ts` 覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  buildCanvasTemplateGuidance,
} from "../../src/application/agent-run/canvas-template-guidance";
import { buildSystemPrompt, VISUALIZATION_GUIDANCE } from "../../src/application/agent-run/execute-run";

describe("issue #1493 buildCanvasTemplateGuidance", () => {
  it("空列表返回 null——不注入假清单", () => {
    expect(buildCanvasTemplateGuidance([])).toBeNull();
  });

  it("非空列表拼出 key + 分区名 + canvas 围栏格式说明", () => {
    const guidance = buildCanvasTemplateGuidance([
      { key: "persona", displayName: "用户画像", sections: [{ name: "用户描述" }, { name: "目标和需求" }] },
      { key: "swot", displayName: "SWOT 分析", sections: [{ name: "优势" }, { name: "劣势" }] },
    ]);
    expect(guidance).not.toBeNull();
    expect(guidance).toContain("persona〔用户描述/目标和需求〕");
    expect(guidance).toContain("swot〔优势/劣势〕");
    expect(guidance).toContain("```canvas");
    expect(guidance).toContain("模板: <key>");
  });
});

describe("issue #1493 buildSystemPrompt 的可选 canvasGuidance 参数", () => {
  it("不传第三参数 —— 与本次改动之前逐字节相同（既有调用点 trial-run-agent/quick-digital-interview 不受影响）", () => {
    const withoutArg = buildSystemPrompt("INSTR", [{ versionId: "v1", content: "SKILL-A" }]);
    const withUndefined = buildSystemPrompt("INSTR", [{ versionId: "v1", content: "SKILL-A" }], undefined);
    expect(withoutArg).toBe(withUndefined);
    expect(withoutArg).toBe(["INSTR", "SKILL-A", VISUALIZATION_GUIDANCE].join("\n\n"));
  });

  it("传 null —— 同样不注入（与不传等价）", () => {
    const withNull = buildSystemPrompt("INSTR", [], null);
    expect(withNull).toBe(["INSTR", VISUALIZATION_GUIDANCE].join("\n\n"));
  });

  it("传非空字符串 —— 追加在 VISUALIZATION_GUIDANCE 之后", () => {
    const sys = buildSystemPrompt("INSTR", [], "CANVAS-GUIDANCE-TEXT");
    expect(sys.indexOf(VISUALIZATION_GUIDANCE)).toBeLessThan(sys.indexOf("CANVAS-GUIDANCE-TEXT"));
    expect(sys.endsWith("CANVAS-GUIDANCE-TEXT")).toBe(true);
  });
});
