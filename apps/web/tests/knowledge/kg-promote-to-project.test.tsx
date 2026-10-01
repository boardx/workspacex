/**
 * 项目中枢 R7 —— 知识面板「记到项目大脑」。
 * 钉住：服务端 `canPromoteToProject` + 传了 `onPromoteToProject` 才出现；引导师（非创建者，canEdit=false）
 * 也能用；提交把选中的 claimIds 交给 onPromoteToProject；成功后显示条数；`canPromoteToProject` 缺省（旧响应）
 * 或 false ⇒ 没有入口。
 */
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";

const SCOPE = { kind: "chat_session", id: "thr-r7" } as const;
const claim = (id: string, statement: string): KgClaim => ({
  id, scope: SCOPE, kind: "fact", statement, status: "accepted", triState: "confirmed",
  confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
  aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T08:00:00Z",
});
const knowledge = (over: Partial<{ canEdit: boolean; canPromote: boolean; canPromoteToProject: boolean }> = {}): ThreadKnowledge =>
  knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE, revision: 1, objects: [], claims: [claim("c1", "并网周期是首要阻碍"), claim("c2", "客户看重交付确定性")], edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: false, canPromote: false, visibility: "thread_members", extractionActive: true, ...over,
  });

describe("R7 记到项目大脑", () => {
  it("引导师（非创建者）：canPromoteToProject=true ⇒ 有入口；选两条提交 ⇒ onPromoteToProject 收到这两条；显示已记条数", async () => {
    const onPromoteToProject = vi.fn(async (ids: string[]) => ({
      results: ids.map((claimId) => ({ claimId, outcome: "promoted" as const, personalClaimId: `p-${claimId}` })),
    }));
    render(<KnowledgePanel status="ready" data={knowledge({ canPromoteToProject: true })} writeActions={{ apply: vi.fn(), onPromoteToProject }} />);
    fireEvent.click(screen.getByTestId("kg-promote-enter"));
    expect(screen.queryByTestId("kg-promote-submit")).toBeNull(); // 没有个人那条
    for (const id of ["c1", "c2"]) fireEvent.click(screen.getByTestId(`kg-claim-select-${id}`));
    fireEvent.click(screen.getByTestId("kg-promote-project-submit"));
    await waitFor(() => expect(onPromoteToProject).toHaveBeenCalledWith(["c1", "c2"], undefined));
    expect(await screen.findByTestId("kg-promote-project-result")).toHaveTextContent("已记到项目大脑 2 条");
  });

  it("旧响应没有 canPromoteToProject、或为 false ⇒ 没有入口", () => {
    const { unmount } = render(<KnowledgePanel status="ready" data={knowledge()} writeActions={{ apply: vi.fn(), onPromoteToProject: vi.fn() }} />);
    expect(screen.queryByTestId("kg-promote-enter")).toBeNull();
    unmount();
    render(<KnowledgePanel status="ready" data={knowledge({ canPromoteToProject: false })} writeActions={{ apply: vi.fn(), onPromoteToProject: vi.fn() }} />);
    expect(screen.queryByTestId("kg-promote-enter")).toBeNull();
  });

  it("创建者的个人线程：只有「记到我的长期记忆」，没有项目那条", () => {
    render(<KnowledgePanel status="ready" data={knowledge({ canEdit: true, canPromote: true })} writeActions={{ apply: vi.fn(), onPromote: vi.fn() }} />);
    fireEvent.click(screen.getByTestId("kg-promote-enter"));
    expect(screen.getByTestId("kg-promote-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-promote-project-submit")).toBeNull();
  });
});
