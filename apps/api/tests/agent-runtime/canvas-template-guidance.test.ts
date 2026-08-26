/**
 * issue #1493 —— 纯函数单测：`buildCanvasTemplateGuidance` 的拼接与空清单行为，
 * `buildSystemPrompt` 新增的可选第三参数不破坏既有调用点（不传 = 逐字节不变）。
 * 真栈（读库 + 现查 + 不缓存 + 个人对话）由
 * `tests/agent-runtime/canvas-template-guidance-real-db.test.ts` 覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  buildCanvasTemplateGuidance,
  type CanvasTemplateGuidanceInfo,
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

/**
 * 2026-08-26 回归：**表头字段被数了两遍**。
 *
 * ## 是我自己的回填造成的
 *
 * 回填之前，persona 在库里的 `sections` 只有 6 个正文分区，表头字段（姓名/性别/年龄…）
 * 根本没进过契约模型——所以 `listPublished` 才去 `@repo/fabric-markdown` 单独取一份
 * `fields`。那时两份数据**不相交**，拼出来的指引是对的。
 *
 * 2026-08-26 的回填为了让表头字段**可查看可修改**（人类原话「所有的不同阶段的数据
 * 都可以查看和修改」），把它们落成了 `type: "短文本"` 的分区。于是同一批名字现在
 * 同时出现在两处：
 *
 *     - persona〔姓名/性别/…/用户描述/…〕，表头字段〔姓名/性别/…〕
 *
 * 而下面的格式说明要求：分区写 `## 姓名`，表头写 `姓名: 值`。模型会两边都写，
 * 或者选错一边——**产出结构错了，而指引本身读起来完全通顺**。
 *
 * 实测（devapp org-2e5de17f74b8731f）：persona 的 `sections` 现在是 15 条，
 * 其中 9 条 `type = 短文本`。
 *
 * ⚠ 修法**不是**把表头字段从库里拿掉——那会让它们又变回不可编辑，退回人类点名要修的
 *   那个问题。而是让注入端认得 `type`：库现在有这个事实了，正文分区只列
 *   `便利贴列表`/`长文本`，表头字段从 `短文本` 分区来，不再去 package 取第二份。
 */
describe("2026-08-26 回归：表头字段不得同时出现在分区与表头两处", () => {
  const PERSONA_LIKE: CanvasTemplateGuidanceInfo = {
    key: "persona",
    displayName: "用户画像",
    sections: [
      { name: "姓名", type: "短文本" },
      { name: "职位", type: "短文本" },
      { name: "用户描述", type: "便利贴列表" },
      { name: "痛点和挑战", type: "便利贴列表" },
    ],
  };

  it("正文分区里**没有**表头字段", () => {
    const out = buildCanvasTemplateGuidance([PERSONA_LIKE])!;
    const line = out.split("\n").find((l) => l.startsWith("- persona"))!;
    const body = line.slice(0, line.indexOf("，表头字段") >= 0 ? line.indexOf("，表头字段") : undefined);
    expect(body).toContain("用户描述");
    expect(body).toContain("痛点和挑战");
    // 反证的核心：这两个名字**只能**出现在表头那一段，不能出现在分区列表里。
    expect(body).not.toContain("姓名");
    expect(body).not.toContain("职位");
  });

  it("表头字段来自 `短文本` 分区，不再从 package 取第二份", () => {
    const out = buildCanvasTemplateGuidance([PERSONA_LIKE])!;
    expect(out).toContain("表头字段〔姓名/职位〕");
  });

  it("没有短文本分区的模板，不产出「表头字段」那一段", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "swot", displayName: "SWOT",
      sections: [{ name: "优势", type: "便利贴列表" }, { name: "劣势", type: "便利贴列表" }],
    }])!;
    const line = out.split("\n").find((l) => l.startsWith("- swot"))!;
    expect(line).not.toContain("表头字段");
  });
});
