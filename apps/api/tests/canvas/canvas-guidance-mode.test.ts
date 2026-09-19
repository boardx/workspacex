/** #3749 B1.2: in `matched` mode only the templates the message names ride in the prompt. */
import { describe, expect, it } from "vitest";
import { canvasGuidanceModeFromEnv, selectGuidanceTemplates } from "../../src/application/agent-run/canvas-template-guidance";
import { buildSystemPrompt, mentionsDiagramIntent } from "../../src/application/agent-run/execute-run";
import { matchCanvasTemplatesInText, mentionsCanvasIntent } from "../../src/domain/canvas/normalize-fence-template-key";

const T = [
  { key: "persona", displayName: "用户画像" }, { key: "swot", displayName: "SWOT 分析" },
  { key: "pestel", displayName: "PESTEL 分析" }, { key: "journey-map", displayName: "用户旅程图" },
];

describe("selectGuidanceTemplates", () => {
  it("all: the whole library regardless of the message", () => {
    expect(selectGuidanceTemplates(T, { mode: "all", text: "分析网址 https://x.y" })).toHaveLength(4);
  });
  it("matched: nothing for a message that is not about a canvas (URL analysis, chat)", () => {
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "分析网址：https://news.cnyes.com/news/id/1 的内容" })).toEqual([]);
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "用一句话介绍你自己" })).toEqual([]);
  });
  it("matched: only the named template (key, display name or alias)", () => {
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "生成一个用户画像：传媒大学教授" }).map((t) => t.key)).toEqual(["persona"]);
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "make a SWOT for a cafe" }).map((t) => t.key)).toEqual(["swot"]);
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "请基于对话用「用户旅程图」（模板 key：journey-map）产出" }).map((t) => t.key)).toEqual(["journey-map"]);
  });
  it("matched: a canvas request that names no template gets the whole library so the model can pick", () => {
    expect(selectGuidanceTemplates(T, { mode: "matched", text: "帮我做一张画布" })).toHaveLength(4);
  });
  it("mode comes from KERNEL_CANVAS_GUIDANCE_MODE, default all", () => {
    expect(canvasGuidanceModeFromEnv({} as NodeJS.ProcessEnv)).toBe("all");
    expect(canvasGuidanceModeFromEnv({ KERNEL_CANVAS_GUIDANCE_MODE: "matched" } as NodeJS.ProcessEnv)).toBe("matched");
  });
});

describe("text matchers", () => {
  it("aliases resolve through the same table as fence-key correction", () => {
    expect(matchCanvasTemplatesInText("给我一个 user profile", T)).toEqual(["persona"]);
    expect(mentionsCanvasIntent("做个工作坊模板")).toBe(true);
    expect(mentionsCanvasIntent("读取这个网页")).toBe(false);
  });
  it("diagram intent gates the mermaid rules", () => {
    expect(mentionsDiagramIntent("把 OAuth 流程画出来")).toBe(true);
    expect(mentionsDiagramIntent("用一句话介绍你自己")).toBe(false);
  });
});

describe("buildSystemPrompt visualization option", () => {
  it("default keeps the mermaid guidance (byte-identical for existing callers)", () => {
    expect(buildSystemPrompt("x", [])).toContain("可视化（mermaid 图）");
  });
  it("visualization:false drops it", () => {
    expect(buildSystemPrompt("x", [], null, "full", { visualization: false })).not.toContain("mermaid");
  });
});
