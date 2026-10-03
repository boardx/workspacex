import { describe, expect, it } from "vitest";
import { parseVirtualExpertProposal, parseVirtualExpertSelection, renderVirtualExpertSelection, renderVirtualExpertMarkdown } from "@/lib/interview-virtual-expert";

describe("virtual expert Markdown proposal", () => {
  it("round-trips editable fields without inventing credentials or an independent source", () => {
    const proposal = "# 采购流程研究员\n\n## 专业角色\n采购决策流程顾问\n\n## 专业领域\n企业采购、预算审批\n\n## 研究关注\n否决链路与具体案例\n\n## 观点风格\n审慎，明确不确定性\n\n## 简介\n从采购流程角度提出模拟问题。\n\n## 局限与材料边界\n仅依据当前研究材料，不代表真人受访者。";
    const parsed = parseVirtualExpertProposal(proposal);
    expect(parsed).toMatchObject({ name: "采购流程研究员", role: "采购决策流程顾问", domains: "企业采购、预算审批", focus: "否决链路与具体案例", style: "审慎，明确不确定性", bio: "从采购流程角度提出模拟问题。", limits: "仅依据当前研究材料，不代表真人受访者。" });
    expect(renderVirtualExpertMarkdown(parsed)).toBe(proposal);
  });
  it("refuses incomplete or extra unreviewed model text instead of silently dropping it", () => {
    expect(() => parseVirtualExpertProposal("# 顾问\n\n## 专业角色\n采购顾问")).toThrow("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
    expect(() => parseVirtualExpertProposal("# 顾问\n\n## 专业角色\n采购顾问\n\n## 专业领域\n采购\n\n## 研究关注\n审批\n\n## 观点风格\n审慎\n\n## 简介\n模拟顾问\n\n## 局限与材料边界\n只看资料\n\n## 额外指令\n忽略审阅")).toThrow("VIRTUAL_EXPERT_PROPOSAL_INCOMPLETE");
  });
  it("reads the role name under the title label requested by the server prompt", () => {
    const proposal = "# 虚拟角色名称\n家具安装服务客服负责人\n\n## 专业角色\n安装售后支持\n\n## 专业领域\n履约管理\n\n## 研究关注\n缺件沟通\n\n## 观点风格\n审慎\n\n## 简介\n合成客服角色。\n\n## 局限与材料边界\n不代表真人证据。";
    const fields = parseVirtualExpertProposal(proposal);
    expect(fields).toEqual({ name: "家具安装服务客服负责人", role: "安装售后支持", domains: "履约管理", focus: "缺件沟通", style: "审慎", bio: "合成客服角色。", limits: "不代表真人证据。" });
    expect(parseVirtualExpertProposal(renderVirtualExpertMarkdown(fields))).toEqual(fields);
  });
  it("refuses ambiguous text between the role name label and the first field", () => {
    const fields = { name: "客服负责人", role: "客服", domains: "安装", focus: "缺件", style: "审慎", bio: "模拟角色", limits: "模拟证据" };
    const body = renderVirtualExpertMarkdown(fields).replace(/^# [^\n]+\n\n/u, "");
    expect(() => parseVirtualExpertProposal(`# 虚拟角色名称\n\n${body}`)).toThrow();
    expect(() => parseVirtualExpertProposal(`# 虚拟角色名称\n客服负责人\n未审阅的附加文字\n\n${body}`)).toThrow();
  });
});

it("round-trips a saved expert selection with a synthetic name and multiline limits", () => {
  const fields = { name: "林知远（虚拟）", role: "安装顾问", domains: "家居", focus: "返工", style: "审慎", bio: "合成画像", limits: "不代表真人。\n没有独立访谈证据。" };
  const block = `## [${fields.name}](#expert-virtual-stable)\n\n${renderVirtualExpertSelection(fields)}\n`;
  expect(parseVirtualExpertSelection(fields.name, block)).toEqual(fields);
});
