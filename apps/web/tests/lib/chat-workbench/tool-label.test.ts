/**
 * 工具词表与「这次调用做了什么」（`lib/chat-workbench/tool-label`）—— 纯函数门控。
 *
 * 2026-09-16 人类实测（非技术用户）的三件事，逐条钉在这里：
 *   ① 真的会出现在这个部署里的工具都有中文名，未知工具仍回退真名（不编）；
 *   ② 参数抽成一句人话：路径只留文件名，认不出就返回 null；
 *   ③ `null` 结果被判成「等于什么都没有」，由展示层改口，而不是把 `null` 印给用户。
 */
import { describe, expect, it } from "vitest";
import { isEmptyToolResult, toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";

describe("toolLabel", () => {
  it("人类实测里那个 read_file 有中文名了", () => {
    expect(toolLabel("read_file")).toBe("读取文件");
  });

  it("未知工具回退到真名——不编一个好听的假名字", () => {
    expect(toolLabel("some_tool_nobody_named")).toBe("some_tool_nobody_named");
  });
});

describe("toolObject —— 折叠行后面那半句", () => {
  it("路径只取文件名：沙箱的内部布局对用户没有意义", () => {
    expect(toolObject("read_file", { file_path: "/workspace/preview-xlsx-review/page-06.png" }))
      .toBe("page-06.png");
  });

  it("URL 取 host", () => {
    expect(toolObject("fetch_url", { url: "https://example.com/a/b?c=1" })).toBe("example.com");
  });

  it("检索类取查询词", () => {
    expect(toolObject("web_search", { query: "2026 H1 产量" })).toBe("2026 H1 产量");
  });

  it("认不出参数就返回 null，由调用方决定退回什么", () => {
    expect(toolObject("mystery", { flag: true, count: 3 })).toBeNull();
    expect(toolObject("read_file", null)).toBeNull();
  });

  it("过长截断，且不劈开 emoji", () => {
    const object = toolObject("web_search", { query: "🙂".repeat(80) });
    expect(object).not.toBeNull();
    expect(Array.from(object as string).length).toBeLessThanOrEqual(32);
    expect(Array.from(object as string).every((c) => c === "🙂" || c === "…")).toBe(true);
  });
});

describe("isEmptyToolResult —— 屏幕上不该出现 null", () => {
  it.each([null, undefined, "", "   ", "null", "undefined", "{}", "[]", {}, []])(
    "%j 判为「没有返回内容」",
    (value) => expect(isEmptyToolResult(value)).toBe(true),
  );

  it.each(["读到 3 行", 0, false, { ok: true }])("%j 是真结果", (value) => {
    expect(isEmptyToolResult(value)).toBe(false);
  });
});
