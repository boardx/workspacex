/**
 * 项目中枢 R8 —— 研究洞察 › 研究总览「项目大脑」面板：真实项目记忆按类型分组；空态如实；403 如实。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const fetchProjectKnowledge = vi.fn();
const fetchClaimSources = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  fetchClaimSources: (...a: unknown[]) => fetchClaimSources(...a),
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
    fetchClaimSources.mockReset();
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

  it("R9 推理：矛盾单列，猜测按净证据升序；来源按钮打开抽屉并按 claimId 取来源", async () => {
    const h = (id: string, statement: string, sup: number, con: number) => ({ ...claim(id, "hypothesis", statement, "pending", "proposed"), supportingCount: sup, contradictingCount: con });
    fetchProjectKnowledge.mockResolvedValue({
      scope: SCOPE, revision: 5, objects: [], edges: [],
      claims: [h("h-strong", "并网周期是首要阻碍", 4, 0), h("h-weak", "业主愿为工期承诺付溢价", 1, 1), claim("x-conf", "fact", "德国先做还是意大利先做", "conflict", "contested"), claim("d1", "decision", "先做德国工商业")],
    });
    fetchClaimSources.mockResolvedValue({
      claim: h("h-weak", "业主愿为工期承诺付溢价", 1, 1),
      evidence: [{ segmentId: "m1", stance: "supporting", sourceKind: "chat_message", sourceRef: "m1", excerpt: "客户说愿意多付一点", locator: null, revoked: false }],
      provenance: [],
    });
    render(<TabResearch view="facilitator" projectId="p1" />);
    const reasoning = await screen.findByTestId("project-brain-reasoning");
    expect(within(screen.getByTestId("project-brain-conflicts")).getByTestId("project-brain-claim-x-conf")).toHaveTextContent("有矛盾");
    const hyps = within(screen.getByTestId("project-brain-hypotheses")).getAllByRole("listitem").map((li) => li.getAttribute("data-testid"));
    expect(hyps).toEqual(["project-brain-claim-h-weak", "project-brain-claim-h-strong"]);
    expect(within(reasoning).queryByTestId("project-brain-claim-d1")).toBeNull();

    fireEvent.click(within(reasoning).getByTestId("project-brain-sources-h-weak"));
    expect(fetchClaimSources).toHaveBeenCalledWith("h-weak");
    expect(await screen.findByText("客户说愿意多付一点")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kg-source-drawer-close"));
    expect(screen.queryByText("客户说愿意多付一点")).toBeNull();
  });

  it("R9 推理：没有猜测也没有矛盾 ⇒ 不画「假设与矛盾」", async () => {
    fetchProjectKnowledge.mockResolvedValue({ scope: SCOPE, revision: 1, objects: [], edges: [], claims: [claim("d1", "decision", "先做德国工商业")] });
    render(<TabResearch view="member" projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    expect(screen.queryByTestId("project-brain-reasoning")).toBeNull();
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
