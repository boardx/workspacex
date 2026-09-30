/**
 * AG04 follow-up —— 成员数字人详情页 `/agent/[id]`（`AgentDetail`）+ 目录卡片跳详情。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentDetail, loadAgentDetailExtras, workflowPrefill, type AgentDetailExtras } from "@/components/agent/agent-detail";
import * as dir from "@/lib/agent-directory";
import * as skill from "@/lib/live-skill";
import { AgentDirectory } from "@/components/agent/agent-directory";
import { ApiError } from "@/lib/api-client";
import type { AgentDirectoryCard } from "@/lib/agent-directory";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const card: AgentDirectoryCard = {
  agentId: "a-sales", versionId: "v1", name: "小销", initials: "销", roleLabel: "Sales Representative",
  avatar: { kind: "illustration", key: "dh-05-sales-representative", alt: "小销" },
  roleCategory: "sales", tags: ["销售", "客户"], catalogSource: "official",
  workflows: [{ stableId: "W005", name: "Lead-to-Proposal" }], readiness: "ready",
};

const extras = (over: Partial<AgentDetailExtras> = {}): AgentDetailExtras => ({
  duty: null, skillSource: "agent", skills: [{ skillId: "s1", name: "报价单生成", duty: "按模板出报价" }],
  delegationTargets: [], requireApprovalForHandoff: true, ...over,
});

describe("AgentDetail", () => {
  it("富头部：头像、中文称呼（不露英文原名、不重复标题）、标签、白话就绪；技能/工作流/转交分节", async () => {
    const onStartChat = vi.fn();
    render(<AgentDetail agentId="a-sales" onStartChat={onStartChat}
      fetchCard={vi.fn().mockResolvedValue(card)}
      fetchExtras={vi.fn().mockResolvedValue(extras({
        delegationTargets: [{ agentId: "a-pm", name: "Product Manager", initials: "P", roleLabel: "Product Manager", avatar: { kind: "illustration", key: "dh-03-product-manager", alt: "x" } }],
      }))} />);
    expect(screen.getByTestId("agent-detail-loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("agent-detail-name").textContent).toBe("销售代表"));
    expect(screen.getByTestId("agent-detail-portrait").getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
    // 英文角色头衔 = 原名 → 不再作为副标题重复出现
    expect(screen.getByTestId("agent-detail").textContent).not.toContain("Sales Representative");
    expect(screen.getByTestId("agent-detail-tags").textContent).toContain("客户");
    expect(screen.getByTestId("agent-detail-readiness").textContent).toContain("随时可以开始对话");
    expect(screen.getByTestId("agent-detail-duty").textContent).toContain("销售管道");
    await waitFor(() => expect(screen.getAllByTestId("agent-detail-skill")).toHaveLength(1));
    expect(screen.getByTestId("agent-detail-skills").textContent).toContain("报价单生成");
    expect(screen.getByTestId("agent-detail-handoff-target").textContent).toBe("产品经理");
    expect(screen.getByTestId("agent-detail-handoff").textContent).toContain("先征得你的确认");
    fireEvent.click(screen.getByTestId("agent-detail-start-chat"));
    expect(onStartChat).toHaveBeenCalledWith("a-sales");
  });

  it("工作流逐项「在对话中发起」→ 带预填句子跳对话；不显示 W 编号", async () => {
    const onStartChat = vi.fn();
    render(<AgentDetail agentId="a-sales" onStartChat={onStartChat} fetchCard={vi.fn().mockResolvedValue(card)} fetchExtras={vi.fn().mockResolvedValue(extras())} />);
    await waitFor(() => expect(screen.getAllByTestId("agent-detail-workflow")).toHaveLength(1));
    expect(screen.getByTestId("agent-detail-workflows").textContent).not.toContain("W005");
    fireEvent.click(screen.getByTestId("agent-detail-workflow-launch"));
    expect(onStartChat).toHaveBeenCalledWith("a-sales", workflowPrefill("Lead-to-Proposal"));
  });

  it("服务端职责优先；未就绪用白话说明；组织共享技能兜底有说明", async () => {
    render(<AgentDetail agentId="a" onStartChat={vi.fn()}
      fetchCard={vi.fn().mockResolvedValue({ ...card, readiness: "unknown" })}
      fetchExtras={vi.fn().mockResolvedValue(extras({ duty: "只做华东区大客户", skillSource: "org" }))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-skills-org-note")).toBeTruthy());
    expect(screen.getByTestId("agent-detail-duty").textContent).toBe("只做华东区大客户");
    expect(screen.getByTestId("agent-detail-readiness").textContent).toContain("日常对话可以直接开始");
  });

  it("补充信息读失败只影响对应几节；空技能/空工作流/空转交是设计过的空态（有标题+说明，不是「暂无」）", async () => {
    render(<AgentDetail agentId="a" onStartChat={vi.fn()}
      fetchCard={vi.fn().mockResolvedValue({ ...card, workflows: [], tags: [] })}
      fetchExtras={vi.fn().mockRejectedValue(new Error("boom"))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-skills-error")).toBeTruthy());
    expect(screen.getByTestId("agent-detail-handoff-error")).toBeTruthy();
    expect(screen.getByTestId("agent-detail-workflows-empty").textContent).toContain("直接开始对话");
    expect(screen.getByTestId("agent-detail-tags").textContent).toBe("销售");
    cleanup();
    render(<AgentDetail agentId="a" onStartChat={vi.fn()} fetchCard={vi.fn().mockResolvedValue(card)} fetchExtras={vi.fn().mockResolvedValue(extras({ skills: [] }))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-skills-empty")).toBeTruthy());
    expect(screen.getByTestId("agent-detail-handoff-empty").textContent).toContain("亲自跟到底");
    expect(document.body.textContent).not.toMatch(/暂无|没有单独挂载/);
  });

  it("404 → 找不到态（不露码）；500 → 错误态可重试；401 → 拒绝态", async () => {
    const fetchExtras = vi.fn().mockResolvedValue(extras());
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchExtras={fetchExtras} fetchCard={vi.fn().mockRejectedValue(new ApiError(404, "AGENT_NOT_FOUND", {}))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-not-found")).toBeTruthy());
    expect(document.body.textContent).not.toContain("AGENT_NOT_FOUND");
    cleanup();
    const fetchCard = vi.fn().mockRejectedValueOnce(new ApiError(500, null, {})).mockResolvedValueOnce(card);
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchExtras={fetchExtras} fetchCard={fetchCard} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-error")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(screen.getByTestId("agent-detail-name")).toBeTruthy());
    cleanup();
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchExtras={fetchExtras} fetchCard={vi.fn().mockRejectedValue(new ApiError(401, null, {}))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-denied")).toBeTruthy());
  });
});

describe("loadAgentDetailExtras（真实端点组合）", () => {
  it("挂载技能 + 钉住版本技能换成名字；都没有时退回组织共享技能；文件形式说明不当职责", async () => {
    vi.spyOn(dir, "getAgentDirectoryProfile").mockResolvedValue({
      agentId: "a", duty: null, mountedSkillIds: ["s1"], pinnedSkillVersionIds: ["v2"], delegationTargets: [], requireApprovalForHandoff: true,
    });
    const catalog = [
      { skillId: "s1", name: "报价单", duty: "出报价", currentVersionId: "v1", visibility: "org-wide" },
      { skillId: "s2", name: "竞品分析", duty: "这个 skill 的内容是文件形式（导入…）", currentVersionId: "v2", visibility: "org-wide" },
    ];
    vi.spyOn(skill, "listSkills").mockResolvedValue(catalog as never);
    const out = await loadAgentDetailExtras("a", "org-1");
    expect(out.skillSource).toBe("agent");
    expect(out.skills).toEqual([{ skillId: "s1", name: "报价单", duty: "出报价" }, { skillId: "s2", name: "竞品分析", duty: null }]);

    vi.spyOn(dir, "getAgentDirectoryProfile").mockResolvedValue({
      agentId: "a", duty: null, mountedSkillIds: [], pinnedSkillVersionIds: [], delegationTargets: [], requireApprovalForHandoff: true,
    });
    const fallback = await loadAgentDetailExtras("a", "org-1");
    expect(fallback.skillSource).toBe("org");
    expect(fallback.skills.map((s) => s.name)).toEqual(["报价单", "竞品分析"]);
  });
});

describe("AgentDirectory → 详情", () => {
  it("卡片名字与「查看详情」都链到 /agent/<id>", async () => {
    render(<AgentDirectory fetchDirectory={vi.fn().mockResolvedValue([card])} />);
    await waitFor(() => expect(screen.getByTestId("agent-card-detail-link")).toBeTruthy());
    expect(screen.getByTestId("agent-card-detail-link").getAttribute("href")).toBe("/agent/a-sales");
    expect(screen.getByTestId("agent-card-view-detail").getAttribute("href")).toBe("/agent/a-sales");
  });
});
