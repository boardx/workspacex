/**
 * B3-T4（#4498）—— 项目大脑面板「采纳为项目决策」。
 * 钉住：只有事实 / 猜测有按钮（决定 / 待办没有；分享来的没有）；点按钮弹出理由输入（≤ 500 字，空白不能确认）；
 * 确认 ⇒ `adoptProjectDecision(projectId, claimId, rationale)`；成功后重读，决定区显示「采纳自 …」与理由；
 * 403 KG_NOT_OWNER（观察者）如实显示、按钮还在；界面文字不含禁用词。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";

const fetchProjectKnowledge = vi.fn();
const adoptProjectDecision = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  adoptProjectDecision: (...a: unknown[]) => adoptProjectDecision(...a),
}));

import { ProjectBrainPanel } from "@/components/project/project-brain-panel";

const SCOPE = { kind: "project", id: "p1" } as const;
const claim = (id: string, kind: string, statement: string, over: Record<string, unknown> = {}) => ({
  id, scope: SCOPE, kind, statement, status: "accepted", triState: "confirmed", confidence: 1, createdBy: "model", reviewedBy: null,
  supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 2, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z", ...over,
});
const base = () => ({
  scope: SCOPE, revision: 3, objects: [], edges: [],
  claims: [claim("f1", "fact", "并网周期是首要阻碍"), claim("h1", "hypothesis", "业主愿为工期承诺付溢价", { status: "proposed", triState: "pending" }),
    claim("d0", "decision", "先做德国工商业"), claim("t1", "todo", "下周约 20 位家长"), claim("f2", "fact", "家长预算 2 万")],
  sharedFromPersonal: [{ claimId: "f2", sharedByName: "王五" }],
});
const afterAdopt = () => ({
  ...base(),
  claims: [...base().claims, claim("act-1-g", "decision", "并网周期是首要阻碍", { createdBy: "human", reviewedBy: "u1", derivedFromClaimId: "f1" })],
  adoptedDecisions: [{ decisionClaimId: "act-1-g", sourceClaimId: "f1", rationale: "访谈和转写都指向它", adoptedBy: "李四", adoptedAt: "2026-09-28T00:00:00Z" }],
});

describe("B3-T4 采纳为项目决策", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    fetchProjectKnowledge.mockReset();
    adoptProjectDecision.mockReset();
  });

  it("只有事实 / 猜测有「采纳为项目决策」按钮；决定 / 待办 / 分享来的没有", async () => {
    fetchProjectKnowledge.mockResolvedValue(base());
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    expect(screen.getByTestId("project-brain-adopt-f1")).toHaveTextContent("采纳为项目决策");
    // 猜测同时列在「假设与矛盾」区与类型组里（既有行为），两处都有入口
    expect(screen.getAllByTestId("project-brain-adopt-h1").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("project-brain-adopt-d0")).toBeNull();
    expect(screen.queryByTestId("project-brain-adopt-t1")).toBeNull();
    expect(screen.queryByTestId("project-brain-adopt-f2")).toBeNull();
    expect(screen.queryByTestId("project-brain-adopt-form-f1")).toBeNull();
  });

  it("点按钮弹出理由输入：空白不能确认，最多 500 字；取消收起", async () => {
    fetchProjectKnowledge.mockResolvedValue(base());
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-adopt-f1"));
    const form = await screen.findByTestId("project-brain-adopt-form-f1");
    expect(form).toBeInTheDocument();
    const confirm = screen.getByTestId("project-brain-adopt-confirm-f1");
    expect(confirm).toBeDisabled();
    const ta = screen.getByTestId("project-brain-adopt-rationale-f1") as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(500);
    fireEvent.change(ta, { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(ta, { target: { value: "理".repeat(600) } });
    expect(ta.value).toHaveLength(500);
    expect(confirm).toBeEnabled();
    fireEvent.click(screen.getByTestId("project-brain-adopt-cancel-f1"));
    expect(screen.queryByTestId("project-brain-adopt-form-f1")).toBeNull();
    expect(adoptProjectDecision).not.toHaveBeenCalled();
  });

  it("确认 ⇒ adoptProjectDecision(projectId, claimId, rationale)；成功后重读，决定区显示「采纳自 …」与理由", async () => {
    fetchProjectKnowledge.mockResolvedValueOnce(base()).mockResolvedValueOnce(afterAdopt());
    adoptProjectDecision.mockResolvedValue({ decisionClaimId: "act-1-g", actionId: "act-1" });
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-adopt-f1"));
    fireEvent.change(await screen.findByTestId("project-brain-adopt-rationale-f1"), { target: { value: " 访谈和转写都指向它 " } });
    fireEvent.click(screen.getByTestId("project-brain-adopt-confirm-f1"));
    await waitFor(() => expect(adoptProjectDecision).toHaveBeenCalledWith("p1", "f1", "访谈和转写都指向它"));
    expect(await screen.findByTestId("project-brain-adopt-result-f1")).toHaveTextContent("已采纳为项目决策");
    await waitFor(() => expect(fetchProjectKnowledge).toHaveBeenCalledTimes(2));
    const from = await screen.findByTestId("project-brain-adopted-from-act-1-g");
    expect(from).toHaveTextContent("采纳自「并网周期是首要阻碍」");
    expect(from).toHaveTextContent("理由：访谈和转写都指向它");
    expect(from).toHaveTextContent("由 李四 采纳");
    // 新决定在「决定」组里；来源那条按钮收起（已采纳）
    expect(screen.getByTestId("project-brain-group-decision")).toContainElement(screen.getByTestId("project-brain-claim-act-1-g"));
    expect(screen.queryByTestId("project-brain-adopt-f1")).toBeNull();
    // 本切片自己渲染的文字（按钮 / 表单 / 结果 / 采纳自）不含禁用词——面板其余文字不归本切片管
    const mine = Array.from(document.querySelectorAll('[data-testid^="project-brain-adopt"]')).map((el) => el.textContent ?? "").join("\n");
    expect(mine).toContain("采纳");
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(mine).not.toContain(w);
  });

  it("403 KG_NOT_OWNER（观察者）如实显示，按钮还在可重试；旧响应没有 adoptedDecisions ⇒ 不显示「采纳自」", async () => {
    fetchProjectKnowledge.mockResolvedValue(base());
    adoptProjectDecision.mockRejectedValue(new ApiError(403, "KG_NOT_OWNER", { reasonCode: "KG_NOT_OWNER" }));
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-adopt-f1"));
    fireEvent.change(await screen.findByTestId("project-brain-adopt-rationale-f1"), { target: { value: "理由" } });
    fireEvent.click(screen.getByTestId("project-brain-adopt-confirm-f1"));
    expect(await screen.findByTestId("project-brain-adopt-result-f1")).toHaveTextContent("观察者不能替项目定决策");
    expect(screen.getByTestId("project-brain-adopt-f1")).toBeInTheDocument();
    expect(screen.queryByTestId("project-brain-adopted-from-d0")).toBeNull();
    expect(fetchProjectKnowledge).toHaveBeenCalledTimes(1);
  });
});
