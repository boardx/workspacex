/**
 * 项目中枢 R8 —— 研究洞察 › 研究总览「项目大脑」面板：真实项目记忆按类型分组；空态如实；403 如实。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const fetchProjectKnowledge = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
}));

import { TabResearch } from "@/components/project/tab-research";

const SCOPE = { kind: "project", id: "p1" } as const;
const claim = (id: string, kind: string, statement: string, triState: "pending" | "confirmed" | "conflict" = "confirmed", status = "accepted") => ({
  id, scope: SCOPE, kind, statement, status, triState, confidence: 1, createdBy: "human", reviewedBy: "u1",
  supersedesClaimId: null, derivedFromClaimId: "c0", aboutObjectIds: [], supportingCount: 2, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
});

describe("R8 项目大脑面板", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    fetchProjectKnowledge.mockReset();
  });

  it("真实项目记忆按类型分组显示，带三态与证据数", async () => {
    fetchProjectKnowledge.mockResolvedValue({
      scope: SCOPE, revision: 3, objects: [{ id: "o1", scope: SCOPE, kind: "concept", name: "并网", aliases: [], createdBy: "human", claimCount: 1 }],
      claims: [claim("c1", "decision", "先做德国工商业"), claim("c2", "fact", "并网周期是首要阻碍"), claim("c3", "hypothesis", "业主愿为工期承诺付溢价", "pending", "proposed")],
      edges: [],
    });
    render(<TabResearch view="facilitator" projectId="p1" />);
    const groups = await screen.findByTestId("project-brain-groups");
    expect(groups).toBeInTheDocument();
    expect(screen.getByTestId("project-brain-group-decision")).toHaveTextContent("先做德国工商业");
    expect(screen.getByTestId("project-brain-group-fact")).toHaveTextContent("并网周期是首要阻碍");
    expect(screen.getByTestId("project-brain-group-hypothesis")).toHaveTextContent("业主愿为工期承诺付溢价");
    expect(screen.getByTestId("project-brain-claim-c2")).toHaveTextContent("+2 / −0");
    expect(screen.queryByTestId("project-brain-group-todo")).toBeNull();
    expect(fetchProjectKnowledge).toHaveBeenCalledWith("p1");
  });

  it("空项目：如实空态，并说怎么记", async () => {
    fetchProjectKnowledge.mockResolvedValue({ scope: SCOPE, revision: 0, objects: [], claims: [], edges: [] });
    render(<TabResearch view="member" projectId="p1" />);
    expect(await screen.findByTestId("project-brain-empty")).toHaveTextContent("记到项目大脑");
  });

  it("非成员 403 KG_NOT_VISIBLE：如实显示，可重试", async () => {
    fetchProjectKnowledge.mockRejectedValue(new ApiError(403, "KG_NOT_VISIBLE", { reasonCode: "KG_NOT_VISIBLE" }));
    render(<TabResearch view="facilitator" projectId="p1" />);
    expect(await screen.findByTestId("project-brain-error")).toHaveTextContent("你不在这个项目里");
    expect(screen.getByTestId("project-brain-retry")).toBeInTheDocument();
  });
});
