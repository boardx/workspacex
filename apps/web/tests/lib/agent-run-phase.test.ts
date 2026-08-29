/**
 * issue #2321 追加 -- 人类实测：一次真实 PDF 生成里，聊天连续调用了 `ls`/`glob`
 * 两个 deepagents 内置文件系统工具，运行指示条全程停在同一句"正在调用工具…"
 * 69 秒不变，读起来像卡死。反证 `agent-run-phase.ts` 这一轮加的两处改动：
 * 1. 常见 deepagents 文件系统工具（`ls`/`glob`/`grep`/`read_file`/`write_file`/
 *    `edit_file`）有各自的具体阶段文案，不再落进同一句静态兜底；
 * 2. 表里没收录、但真的有一个观测到的工具名时，原样回显该名字（"正在调用工具
 *    （xxx）…"），不是一句无论换了哪个工具都长得一样的静态文案。
 */
import { describe, expect, it } from "vitest";
import { phaseLabelForToolName, phaseLabelForKind } from "@/lib/agent-run-phase";

describe("phaseLabelForToolName -- deepagents 文件系统工具各自的阶段文案", () => {
  it.each([
    ["ls", "正在查看沙箱文件…"],
    ["glob", "正在搜索文件…"],
    ["grep", "正在搜索文件内容…"],
    ["read_file", "正在读取文件…"],
    ["write_file", "正在写入文件…"],
    ["edit_file", "正在编辑文件…"],
    ["list_org_skills", "正在准备技能…"],
    ["call_skill", "正在执行技能脚本…"],
  ])("%s -> %s", (toolName, expected) => {
    expect(phaseLabelForToolName(toolName)).toBe(expected);
  });
});

describe("phaseLabelForToolName -- 未收录的真实工具名原样回显，不是一句不变的静态文案", () => {
  it("不同的未知工具名产出不同的文案（不会让两次不同的工具调用看起来一模一样）", () => {
    const first = phaseLabelForToolName("some_future_tool_a");
    const second = phaseLabelForToolName("some_future_tool_b");
    expect(first).not.toBe(second);
    expect(first).toContain("some_future_tool_a");
    expect(second).toContain("some_future_tool_b");
  });

  it("仍然以「正在调用工具」开头，与既有的通用兜底措辞保持一致", () => {
    expect(phaseLabelForToolName("some_unmapped_tool")).toContain("正在调用工具");
  });
});

describe("phaseLabelForToolName -- toolName 为 null 时唯一可用的静态兜底（没有任何真实信息可显示）", () => {
  it("null 落回不含任何名字的通用兜底文案", () => {
    expect(phaseLabelForToolName(null)).toBe("正在调用工具…");
  });
});

describe("phaseLabelForKind -- 未识别的 kind 仍然落一句不特指的兜底（本轮未改动的既有行为）", () => {
  it("未来契约新增的 kind 值不报错、不留空", () => {
    expect(phaseLabelForKind("some_future_kind_nobody_has_seen")).toBe("正在处理…");
  });
});
