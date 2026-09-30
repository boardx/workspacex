/**
 * AG04 follow-up —— 成员数字人详情页 `/agent/[id]`（`AgentDetail`）+ 目录卡片跳详情。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentDetail } from "@/components/agent/agent-detail";
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

describe("AgentDetail", () => {
  it("渲染头像、名字、角色、标签、职责、技能、可发起工作流；开始对话带 agentId", async () => {
    const onStartChat = vi.fn();
    render(<AgentDetail agentId="a-sales" onStartChat={onStartChat}
      fetchCard={vi.fn().mockResolvedValue(card)}
      fetchSkills={vi.fn().mockResolvedValue([{ skillId: "s1", name: "报价单生成", duty: "按模板出报价" }])} />);
    expect(screen.getByTestId("agent-detail-loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("agent-detail-name").textContent).toBe("小销"));
    expect(screen.getByTestId("agent-detail-portrait").getAttribute("data-avatar-key")).toBe("dh-05-sales-representative");
    expect(screen.getByTestId("agent-detail-role").textContent).toBe("Sales Representative");
    expect(screen.getByTestId("agent-detail-tags").textContent).toContain("客户");
    expect(screen.getByTestId("agent-detail-duty").textContent).toContain("销售");
    expect(screen.getByTestId("agent-detail-workflows").textContent).toContain("Lead-to-Proposal");
    await waitFor(() => expect(screen.getAllByTestId("agent-detail-skill")).toHaveLength(1));
    expect(screen.getByTestId("agent-detail-skills").textContent).toContain("报价单生成");
    fireEvent.click(screen.getByTestId("agent-detail-start-chat"));
    expect(onStartChat).toHaveBeenCalledWith("a-sales");
  });

  it("技能读失败只影响技能一节；空技能/空工作流有真实空态", async () => {
    render(<AgentDetail agentId="a" onStartChat={vi.fn()}
      fetchCard={vi.fn().mockResolvedValue({ ...card, workflows: [], tags: [] })}
      fetchSkills={vi.fn().mockRejectedValue(new Error("boom"))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-skills-error")).toBeTruthy());
    expect(screen.getByTestId("agent-detail-workflows-empty")).toBeTruthy();
    // 没打标签 → 回退 roleCategory 分类名
    expect(screen.getByTestId("agent-detail-tags").textContent).toBe("销售");
    cleanup();
    render(<AgentDetail agentId="a" onStartChat={vi.fn()} fetchCard={vi.fn().mockResolvedValue(card)} fetchSkills={vi.fn().mockResolvedValue([])} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-skills-empty")).toBeTruthy());
  });

  it("404 → 找不到态（不露码）；500 → 错误态可重试；401 → 拒绝态", async () => {
    const fetchSkills = vi.fn().mockResolvedValue([]);
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchSkills={fetchSkills} fetchCard={vi.fn().mockRejectedValue(new ApiError(404, "AGENT_NOT_FOUND", {}))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-not-found")).toBeTruthy());
    expect(document.body.textContent).not.toContain("AGENT_NOT_FOUND");
    cleanup();
    const fetchCard = vi.fn().mockRejectedValueOnce(new ApiError(500, null, {})).mockResolvedValueOnce(card);
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchSkills={fetchSkills} fetchCard={fetchCard} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-error")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    await waitFor(() => expect(screen.getByTestId("agent-detail-name")).toBeTruthy());
    cleanup();
    render(<AgentDetail agentId="x" onStartChat={vi.fn()} fetchSkills={fetchSkills} fetchCard={vi.fn().mockRejectedValue(new ApiError(401, null, {}))} />);
    await waitFor(() => expect(screen.getByTestId("agent-detail-denied")).toBeTruthy());
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
