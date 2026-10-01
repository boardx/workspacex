/**
 * B3-T3（#4497）—— 项目大脑面板的三区：跨来源冲突 / 缺口与建议 / 推理链。
 * 引用可点：有 `evidenceId` 的链到来源页并带 `evidence=`；没有的回退到来源抽屉。文案不含禁用词。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";

const fetchProjectKnowledge = vi.fn();
const fetchProjectReasoning = vi.fn();
const fetchClaimSources = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/projects/p1", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  fetchProjectReasoning: (...a: unknown[]) => fetchProjectReasoning(...a),
  fetchClaimSources: (...a: unknown[]) => fetchClaimSources(...a),
}));

import { evidenceHref, ProjectBrainPanel } from "@/components/project/project-brain-panel";

const SCOPE = { kind: "project", id: "p1" } as const;
const claim = (id: string, kind: string, statement: string) => ({
  id, scope: SCOPE, kind, statement, status: "accepted", triState: "confirmed", confidence: 1, createdBy: "human", reviewedBy: "u1",
  supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
});
const KNOWLEDGE = {
  scope: SCOPE, revision: 3, objects: [], edges: [],
  claims: [claim("a", "fact", "德国 9/29 上线"), claim("b", "fact", "德国 改到 10/1 上线"), claim("d1", "decision", "先做德国工商业"), claim("h1", "hypothesis", "业主愿为工期承诺付溢价")],
};
const REASONING = {
  computedAt: "2026-09-27T12:00:00.000Z",
  conflicts: [{
    id: "conflict:a:b", claimIds: ["a", "b"], statementA: "德国 9/29 上线", statementB: "德国 改到 10/1 上线",
    sourceKindsA: ["chat_message"], sourceKindsB: ["survey_response"], evidenceIdsA: [], evidenceIdsB: ["ev-b1"], kind: "cross_source",
  }],
  gaps: [
    { claimId: "h1", statement: "业主愿为工期承诺付溢价", kind: "single_source", sourceKinds: ["chat_message"], suggestion: "只有对话支持，建议用访谈或问卷验证。" },
    { claimId: "d2", statement: "先做意大利", kind: "no_evidence", sourceKinds: [], suggestion: "这个决定还没有任何来源支持，建议补上做出它所依据的材料。" },
  ],
  chains: [{
    claimId: "d1", statement: "先做德国工商业",
    steps: [
      { kind: "premise", text: "并网周期是首要阻碍", evidenceIds: ["ev-f"], sourceKinds: ["interview_segment"], claimId: "f1" },
      { kind: "premise", text: "团队讨论后先做德国", evidenceIds: [], sourceKinds: ["chat_message"], claimId: "d1" },
      { kind: "inference", text: "先做德国工商业", evidenceIds: ["ev-f"], sourceKinds: ["chat_message", "interview_segment"], claimId: "d1" },
    ],
  }],
};

describe("B3-T3 项目大脑：跨来源推理三区", () => {
  beforeEach(() => {
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
    fetchProjectKnowledge.mockReset().mockResolvedValue(KNOWLEDGE);
    fetchProjectReasoning.mockReset().mockResolvedValue(REASONING);
    fetchClaimSources.mockReset();
  });

  it("三区都画出来，引用有 evidenceId 的链到来源页并带 evidence= 参数", async () => {
    render(<ProjectBrainPanel projectId="p1" />);
    const conflicts = await screen.findByTestId("project-brain-cross-conflicts");
    expect(fetchProjectReasoning).toHaveBeenCalledWith("p1");
    expect(within(conflicts).getByTestId("project-brain-cross-conflict-conflict:a:b")).toHaveTextContent("不同来源");
    expect(conflicts).toHaveTextContent("德国 9/29 上线");
    expect(conflicts).toHaveTextContent("问卷答卷");
    const link = within(conflicts).getByTestId("project-brain-cross-conflict-conflict:a:b-B-evidence-ev-b1");
    expect(link).toHaveAttribute("href", "/projects/p1?tab=research&sub=sources&evidence=ev-b1");
    expect(evidenceHref("p/1", "ev 1")).toBe("/projects/p%2F1?tab=research&sub=sources&evidence=ev%201");

    const gaps = screen.getByTestId("project-brain-gaps");
    expect(within(gaps).getByTestId("project-brain-gap-h1-suggestion")).toHaveTextContent("只有对话支持，建议用访谈或问卷验证。");
    expect(within(gaps).getByTestId("project-brain-gap-d2")).toHaveTextContent("没有出处");

    const chains = screen.getByTestId("project-brain-chains");
    const steps = within(chains).getAllByTestId(/project-brain-chain-d1-step-\d$/).map((el) => el.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain("前提");
    expect(steps[2]).toContain("推论");
    expect(within(chains).getByTestId("project-brain-chain-d1-step-0-cite-evidence-ev-f")).toHaveAttribute("href", "/projects/p1?tab=research&sub=sources&evidence=ev-f");
  });

  it("没有 evidenceId 的引用回退到来源抽屉（按 claimId 取来源）", async () => {
    fetchClaimSources.mockResolvedValue({
      claim: claim("d1", "decision", "先做德国工商业"),
      evidence: [{ segmentId: "m1", stance: "supporting", sourceKind: "chat_message", sourceRef: "m1", excerpt: "团队讨论后先做德国", locator: null, revoked: false }],
      provenance: [],
    });
    render(<ProjectBrainPanel projectId="p1" />);
    const chains = await screen.findByTestId("project-brain-chains");
    fireEvent.click(within(chains).getByTestId("project-brain-chain-d1-step-1-cite-fallback"));
    expect(fetchClaimSources).toHaveBeenCalledWith("d1");
    expect(await screen.findByText("团队讨论后先做德国", { selector: "[data-testid^='kg-source'] *, [data-testid^='kg-source']" })).toBeInTheDocument();

    // 冲突 A 侧没有 evidenceId ⇒ 也是回退按钮，按 A 的 claimId 取来源
    fireEvent.click(screen.getByTestId("project-brain-cross-conflict-conflict:a:b-A-fallback"));
    expect(fetchClaimSources).toHaveBeenLastCalledWith("a");
  });

  it("三块都空 ⇒ 整节不画；推理接口单独失败 ⇒ 只在这一区说明，项目记忆照常显示", async () => {
    fetchProjectReasoning.mockResolvedValue({ computedAt: "2026-09-27T12:00:00.000Z", conflicts: [], gaps: [], chains: [] });
    const { unmount } = render(<ProjectBrainPanel projectId="p1" />);
    await screen.findByTestId("project-brain-groups");
    expect(screen.queryByTestId("project-brain-cross-reasoning")).toBeNull();
    unmount();

    fetchProjectReasoning.mockRejectedValue(new ApiError(503, "authz_unavailable", {}));
    render(<ProjectBrainPanel projectId="p1" />);
    expect(await screen.findByTestId("project-brain-cross-error")).toBeInTheDocument();
    expect(screen.getByTestId("project-brain-groups")).toHaveTextContent("先做德国工商业");
  });

  it("界面文字不含禁用词", async () => {
    render(<ProjectBrainPanel projectId="p1" />);
    const section = await screen.findByTestId("project-brain-cross-reasoning");
    for (const word of KG_BANNED_USER_FACING_WORDS) expect(section.textContent ?? "").not.toContain(word);
  });
});
