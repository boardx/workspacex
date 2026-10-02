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
  workflows: [{ stableId: "W005", name: "Lead-to-Proposal（线索到方案）" }], readiness: "ready",
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
    expect(onStartChat).toHaveBeenCalledWith("a-sales", workflowPrefill("线索到方案"));
    expect(onStartChat.mock.calls[0]![1]).toContain("「线索到方案」");
  });

  it("没有中文显示名的工作流：预填句不带占位名 / 英文名，用中性句", async () => {
    const onStartChat = vi.fn();
    const only = { ...card, workflows: [{ stableId: "zz-custom", name: "Zz-Custom-Flow" }] };
    render(<AgentDetail agentId="a-sales" onStartChat={onStartChat} fetchCard={vi.fn().mockResolvedValue(only)} fetchExtras={vi.fn().mockResolvedValue(extras())} />);
    await waitFor(() => expect(screen.getAllByTestId("agent-detail-workflow")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("agent-detail-workflow-launch"));
    const prefill = onStartChat.mock.calls[0]![1] as string;
    expect(prefill).toBe("帮我发起一个工作流。我的目标是：");
    expect(prefill).not.toContain("未命名流程");
    expect(workflowPrefill("未命名流程")).toBe(prefill);
    expect(workflowPrefill("Zz-Custom-Flow")).toBe(prefill);
  });

  it("服务端职责优先；未就绪用白话说明；待验证技能单独展示", async () => {
    render(<AgentDetail agentId="a" onStartChat={vi.fn()}
      fetchCard={vi.fn().mockResolvedValue({ ...card, readiness: "unknown" })}
      fetchExtras={vi.fn().mockResolvedValue(extras({ duty: "只做华东区大客户", pendingSkills: [{stableId:"stable-pending",stableName:"S901",contentDigest:"a".repeat(64),reason:"awaiting_verification",displayName:"验证需求"}] }))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-pending-skill")).toHaveTextContent("待验证"));
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
  it("只展示已发布精确pins，忽略草稿挂载，空pins不退回组织池", async () => {
    vi.spyOn(dir, "getAgentDirectoryProfile").mockResolvedValue({
      agentId: "a", duty: null, mountedSkillIds: ["s1"], pinnedSkillVersionIds: ["old-v2"], pinnedSkills:[{skillId:"s2",versionId:"old-v2"}], pendingSkillBindings:[], delegationTargets: [], requireApprovalForHandoff: true,
    });
    const catalog = [
      { skillId: "s1", name: "报价单", duty: "出报价", currentVersionId: "v1", visibility: "org-wide" },
      { skillId: "s2", name: "竞品分析", duty: "这个 skill 的内容是文件形式（导入…）", currentVersionId: "v2", visibility: "org-wide" },
    ];
    vi.spyOn(skill, "listSkills").mockResolvedValue(catalog as never);
    const out = await loadAgentDetailExtras("a", "org-1");
    expect(out.skillSource).toBe("agent");
    expect(out.skills).toEqual([{ skillId: "s2", versionId:"old-v2", name: "竞品分析", duty: null }]);

    vi.spyOn(dir, "getAgentDirectoryProfile").mockResolvedValue({
      agentId: "a", duty: null, mountedSkillIds: [], pinnedSkillVersionIds: [], pinnedSkills:[], pendingSkillBindings:[], delegationTargets: [], requireApprovalForHandoff: true,
    });
    const fallback = await loadAgentDetailExtras("a", "org-1");
    expect(fallback.skillSource).toBe("agent");
    expect(fallback.skills).toEqual([]);
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

describe('published role skill detail boundary',()=>{
 it('uses only metadata for historical pins and never substitutes the latest contract',async()=>{
  vi.spyOn(dir,'getAgentDirectoryProfile').mockResolvedValue({agentId:'a',duty:'职责',mountedSkillIds:['draft-only'],pinnedSkillVersionIds:['historical-version'],pinnedSkills:[{skillId:'bound-skill',versionId:'historical-version'}],pendingSkillBindings:[{stableId:'pending-stable',stableName:'S901',contentDigest:'a'.repeat(64),reason:'missing_version'}],delegationTargets:[],requireApprovalForHandoff:true});
  vi.spyOn(skill,'listSkills').mockResolvedValue([]);
  const detail=vi.spyOn(skill,'getSkillDetail').mockResolvedValue({skill:{skillId:'bound-skill',name:'真实技能名称',duty:'最新版本职责',currentVersionId:'latest-version'},contract:{systemPrompt:'最新正文不能代替旧pin'}} as never);
  const result=await loadAgentDetailExtras('a','org');expect(detail).toHaveBeenCalledWith('bound-skill');expect(detail).not.toHaveBeenCalledWith('draft-only');expect(result.skills).toEqual([{skillId:'bound-skill',versionId:'historical-version',name:'真实技能名称',duty:null}]);expect(result.pendingSkills).toHaveLength(1);
 });
 it('keeps a pending-only role at zero executable skills and preserves chat and workflow entry',async()=>{
  render(<AgentDetail agentId="a" onStartChat={vi.fn()} fetchCard={vi.fn().mockResolvedValue(card)} fetchExtras={vi.fn().mockResolvedValue(extras({skills:[],pendingSkills:[{stableId:'pending-stable',stableName:'S901',contentDigest:'a'.repeat(64),reason:'missing_version',displayName:'真实待验证技能'}]}))}/>);
  const item=await screen.findByTestId('agent-detail-pending-skill');
  expect(screen.getByTestId('agent-detail-readiness')).toHaveTextContent('日常对话可以直接开始');
  expect(screen.getByTestId('agent-detail-readiness')).toHaveTextContent('待验证 1 项技能暂不可用');
  expect(screen.getByTestId('agent-detail-readiness')).not.toHaveTextContent('能力都已开通');
  expect(screen.getByTestId('agent-detail-start-chat')).toBeEnabled();
  expect(screen.getByTestId('agent-detail-workflow-launch')).toBeEnabled();expect(item).toHaveAttribute('aria-disabled','true');expect(item).toHaveAttribute('data-state','missing_version');expect(item).toHaveAttribute('data-skill-stable-id','pending-stable');expect(item).toHaveTextContent('版本缺失');expect(screen.queryByTestId('agent-detail-skill')).not.toBeInTheDocument();expect(screen.getByTestId('agent-detail-skill-counts')).toHaveAttribute('data-available-count','0');expect(screen.getByTestId('agent-detail-skill-counts')).toHaveAttribute('data-pending-count','1');expect(screen.getByTestId('agent-detail-start-chat')).toBeInTheDocument();expect(screen.getByTestId('agent-detail-workflow-launch')).toBeInTheDocument();
 });
});
