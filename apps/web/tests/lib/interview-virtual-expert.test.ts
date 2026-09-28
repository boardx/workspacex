import { describe, expect, it } from "vitest";
import { parseVirtualExpertProposal, renderVirtualExpertMarkdown } from "@/lib/interview-virtual-expert";

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
});
