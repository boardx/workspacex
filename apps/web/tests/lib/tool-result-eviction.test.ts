import { describe, expect, it } from "vitest";

import { evictedToolResultNotice, parseEvictedToolResult } from "@/lib/tool-result-eviction";

// 逐字取自 2026-09-06 devapp /chat 实测（deepagents 0.7.6 FilesystemMiddleware 驱逐占位）。
const SAMPLE =
  "Tool result too large, the result of this tool call call_ZS5pTn0Y was saved in the filesystem at this path: /large_tool_results/call_ZS5pTn0Y\n\n" +
  "You can read the result from the filesystem by using the read_file tool, but make sure to only read part of the result at a time.\n\n" +
  "You can do this by specifying an offset and limit in the read_file tool call. For example, to read the first 100 lines, you can use the read_file tool with offset=0 and limit=100.\n\n" +
  "Here is a preview of the result:\n\n# 汇报\n第一行…";

describe("parseEvictedToolResult", () => {
  it("识别内核驱逐占位：返回沙箱路径与原文", () => {
    const parsed = parseEvictedToolResult(SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed?.path).toBe("/large_tool_results/call_ZS5pTn0Y");
    expect(parsed?.raw).toBe(SAMPLE);
  });

  it("容忍首部空白", () => {
    expect(parseEvictedToolResult(`\n  ${SAMPLE}`)?.path).toBe("/large_tool_results/call_ZS5pTn0Y");
  });

  it("只以那句话开头、没有路径 → 不是驱逐", () => {
    expect(parseEvictedToolResult("Tool result too large, sorry.")).toBeNull();
  });

  it("普通结果里恰好提到路径 → 不是驱逐（宁漏判不错标）", () => {
    expect(parseEvictedToolResult("已读取 /large_tool_results/call_x 的前 100 行：…")).toBeNull();
  });

  it("空值 / 非字符串 / 普通结果 → null", () => {
    expect(parseEvictedToolResult(null)).toBeNull();
    expect(parseEvictedToolResult(undefined)).toBeNull();
    expect(parseEvictedToolResult("")).toBeNull();
    expect(parseEvictedToolResult("检索到 3 篇文档")).toBeNull();
  });
});

describe("evictedToolResultNotice", () => {
  it("中文提示带上路径，不含英文原文", () => {
    const notice = evictedToolResultNotice("/large_tool_results/call_ZS5pTn0Y");
    expect(notice).toContain("/large_tool_results/call_ZS5pTn0Y");
    expect(notice).toContain("已存为文件");
    expect(notice).not.toContain("Tool result too large");
  });
});
