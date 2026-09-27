/**
 * B2-S4（#4428）—— 项目大脑面板「记到组织记忆」。
 * 钉住：服务端 `canPromoteToOrg=true` 才出现按钮（旧响应 / false ⇒ 没有入口）；点一条 ⇒ `promoteToOrg(projectId, [id])`；
 * 逐条显示结果（已记 / 已合并 / 相近需选择——选「合并」把 choices 再交回去）；403 KG_NOT_OWNER 如实显示。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const fetchProjectKnowledge = vi.fn();
const promoteToOrg = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  promoteToOrg: (...a: unknown[]) => promoteToOrg(...a),
}));

import { ProjectBrainPanel } from "@/components/project/project-brain-panel";

const SCOPE = { kind: "project", id: "p1" } as const;
const claim = (id: string, statement: string) => ({
  id, scope: SCOPE, kind: "decision", statement, status: "accepted", triState: "confirmed", confidence: 1, createdBy: "human", reviewedBy: "u1",
  supersedesClaimId: null, derivedFromClaimId: "c0", aboutObjectIds: [], supportingCount: 2, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
});
const knowledge = (over: Record<string, unknown> = {}) => ({
  scope: SCOPE, revision: 3, objects: [], edges: [], claims: [claim("c1", "先做德国工商业"), claim("c2", "并网周期是首要阻碍")], ...over,
});

describe("B2-S4 记到组织记忆", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    fetchProjectKnowledge.mockReset();
    promoteToOrg.mockReset();
  });

  it("旧响应没有 canPromoteToOrg、或为 false ⇒ 没有按钮", async () => {
    fetchProjectKnowledge.mockResolvedValue(knowledge());
    const { unmount } = render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    expect(screen.queryByTestId("project-brain-promote-org-c1")).toBeNull();
    unmount();
    fetchProjectKnowledge.mockResolvedValue(knowledge({ canPromoteToOrg: false }));
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    expect(screen.queryByTestId("project-brain-promote-org-c1")).toBeNull();
  });

  it("canPromoteToOrg=true ⇒ 每条有按钮；点一条 ⇒ promoteToOrg(projectId, [id])；已记 / 已合并逐条显示，按钮随之收起", async () => {
    fetchProjectKnowledge.mockResolvedValue(knowledge({ canPromoteToOrg: true }));
    promoteToOrg
      .mockResolvedValueOnce({ results: [{ claimId: "c1", outcome: "promoted", personalClaimId: "g-1" }] })
      .mockResolvedValueOnce({ results: [{ claimId: "c2", outcome: "merged_into_existing", personalClaimId: "g-0" }] });
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-promote-org-c1"));
    await waitFor(() => expect(promoteToOrg).toHaveBeenCalledWith("p1", ["c1"], undefined));
    expect(await screen.findByTestId("project-brain-promote-org-result-c1")).toHaveTextContent("已记到组织记忆");
    expect(screen.queryByTestId("project-brain-promote-org-c1")).toBeNull();
    expect(screen.getByTestId("project-brain-promote-org-c2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-brain-promote-org-c2"));
    expect(await screen.findByTestId("project-brain-promote-org-result-c2")).toHaveTextContent("已有同一条，已合并");
  });

  it("相近 ⇒ 问合并还是分开记；选「合并」把 choices 再交回同一接口", async () => {
    fetchProjectKnowledge.mockResolvedValue(knowledge({ canPromoteToOrg: true }));
    promoteToOrg
      .mockResolvedValueOnce({ results: [{ claimId: "c1", outcome: "needs_choice", existingPersonalClaimId: "g-9" }] })
      .mockResolvedValueOnce({ results: [{ claimId: "c1", outcome: "merged_into_existing", personalClaimId: "g-9" }] });
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-promote-org-c1"));
    expect(await screen.findByTestId("project-brain-promote-org-result-c1")).toHaveTextContent("相近");
    fireEvent.click(screen.getByTestId("project-brain-promote-org-merge-c1"));
    await waitFor(() => expect(promoteToOrg).toHaveBeenLastCalledWith("p1", ["c1"], [{ claimId: "c1", choice: "merge" }]));
    expect(await screen.findByText("组织记忆里已有同一条，已合并。")).toBeInTheDocument();
  });

  it("403 KG_NOT_OWNER 如实显示，按钮还在可重试", async () => {
    fetchProjectKnowledge.mockResolvedValue(knowledge({ canPromoteToOrg: true }));
    promoteToOrg.mockRejectedValue(new ApiError(403, "KG_NOT_OWNER", { reasonCode: "KG_NOT_OWNER" }));
    render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    fireEvent.click(screen.getByTestId("project-brain-promote-org-c1"));
    expect(await screen.findByTestId("project-brain-promote-org-result-c1")).toHaveTextContent("只有组织负责人或管理员");
    expect(screen.getByTestId("project-brain-promote-org-c1")).toBeInTheDocument();
  });
});
