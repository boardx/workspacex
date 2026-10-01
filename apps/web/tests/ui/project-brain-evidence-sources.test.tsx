/**
 * 项目中枢 B3-T2（#4496）—— 项目大脑面板的结论卡片显示证据来源类型标签（按锚点 sourceKind 去重，文案取契约），
 * 被设置页「AI 权限」关掉的来源标灰、title「来源已关闭」（按 `getProjectAiSettings` 本地推导）。
 * 只 mock 网络边界（`@/lib/knowledge-graph-api`、`@/lib/live-project-ai-settings`）。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { PROJECT_EVIDENCE_SOURCE_LABEL_ZH, type ProjectEvidenceSourceKind } from "@repo/contracts/project-evidence";

const fetchProjectKnowledge = vi.fn();
const fetchClaimSources = vi.fn();
const getProjectAiSettings = vi.fn();
vi.mock("@/lib/knowledge-graph-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/knowledge-graph-api")>()),
  fetchProjectKnowledge: (...a: unknown[]) => fetchProjectKnowledge(...a),
  fetchClaimSources: (...a: unknown[]) => fetchClaimSources(...a),
}));
vi.mock("@/lib/live-project-ai-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-ai-settings")>()),
  getProjectAiSettings: (...a: unknown[]) => getProjectAiSettings(...a),
}));

import { ProjectBrainPanel, closedEvidenceKinds, evidenceSourceKinds } from "@/components/project/project-brain-panel";

const SCOPE = { kind: "project", id: "p1" } as const;
const ALL = ["chat", "whiteboard", "transcript", "survey", "interview", "research"] as const;
const claim = (id: string, kind: string, statement: string) => ({
  id, scope: SCOPE, kind, statement, status: "proposed", triState: "pending", confidence: 0.8, createdBy: "model", reviewedBy: null,
  supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T00:00:00Z",
});
const anchor = (evidenceId: string, sourceKind: ProjectEvidenceSourceKind) => ({
  segmentId: evidenceId, stance: "supporting" as const, sourceKind, sourceRef: `ref-${evidenceId}`, evidenceId, excerpt: "原话", locator: null, revoked: false,
});
const sources = (id: string, kinds: readonly ProjectEvidenceSourceKind[]) => ({
  claim: claim(id, "fact", "x"), evidence: kinds.map((k, i) => anchor(`${id}-ev${i}`, k)), provenance: [],
});

beforeEach(() => {
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
  fetchProjectKnowledge.mockReset();
  fetchClaimSources.mockReset();
  getProjectAiSettings.mockReset();
});

describe("B3-T2 纯函数", () => {
  it("closedEvidenceKinds：关掉 chat 开关 ⇒ 对话与附件都关；null（没读到）⇒ 什么都不标", () => {
    expect([...closedEvidenceKinds(["whiteboard", "transcript", "survey", "interview", "research"])]).toEqual(["chat_message", "attachment"]);
    expect([...closedEvidenceKinds([...ALL])]).toEqual([]);
    expect([...closedEvidenceKinds([])]).toHaveLength(7);
    expect([...closedEvidenceKinds(null)]).toEqual([]);
  });
  it("evidenceSourceKinds：按锚点 sourceKind 去重，顺序稳定（契约枚举顺序）", () => {
    expect(evidenceSourceKinds([anchor("a", "transcript_segment"), anchor("b", "survey_response"), anchor("c", "survey_response")]))
      .toEqual(["survey_response", "transcript_segment"]);
  });
});

describe("B3-T2 项目大脑面板：证据来源类型标签", () => {
  it("每条结论按锚点来源去重显示标签，文案来自契约；全开时没有一条标「已关闭」", async () => {
    fetchProjectKnowledge.mockResolvedValue({ scope: SCOPE, revision: 1, objects: [], edges: [], claims: [claim("c1", "fact", "并网周期是首要阻碍"), claim("c2", "decision", "先做德国")] });
    fetchClaimSources.mockImplementation(async (id: string) => (id === "c1"
      ? sources("c1", ["survey_response", "survey_response", "transcript_segment"])
      : sources("c2", ["chat_message"])));
    getProjectAiSettings.mockResolvedValue({ projectId: "p1", allowedSources: [...ALL], updatedAt: null, updatedBy: null });

    render(<ProjectBrainPanel projectId="p1" />);
    const c1 = await screen.findByTestId("project-brain-source-kinds-c1");
    const labels = within(c1).getAllByTestId(/project-brain-source-kind-c1-/).map((el) => el.textContent);
    expect(labels).toEqual([PROJECT_EVIDENCE_SOURCE_LABEL_ZH.survey_response, PROJECT_EVIDENCE_SOURCE_LABEL_ZH.transcript_segment]);
    expect(labels).toEqual(["问卷答卷", "转写片段"]);
    expect(await screen.findByTestId("project-brain-source-kind-c2-chat_message")).toHaveTextContent("对话");
    for (const el of screen.getAllByTestId(/project-brain-source-kind-/)) {
      expect(el).not.toHaveAttribute("data-closed");
      expect(el).not.toHaveAttribute("title");
    }
    expect(fetchClaimSources).toHaveBeenCalledWith("c1");
    expect(fetchClaimSources).toHaveBeenCalledWith("c2");
    expect(getProjectAiSettings).toHaveBeenCalledWith("p1");
  });

  it("来源被 AI 权限关掉：那类标签标灰、title「来源已关闭」；结论本身仍在，其它来源不受影响", async () => {
    fetchProjectKnowledge.mockResolvedValue({ scope: SCOPE, revision: 2, objects: [], edges: [], claims: [claim("c1", "fact", "并网周期是首要阻碍")] });
    fetchClaimSources.mockResolvedValue(sources("c1", ["survey_response", "interview_segment", "attachment"]));
    getProjectAiSettings.mockResolvedValue({ projectId: "p1", allowedSources: ["interview", "research"], updatedAt: "2026-09-27T00:00:00Z", updatedBy: "u1" });

    render(<ProjectBrainPanel projectId="p1" />);
    const survey = await screen.findByTestId("project-brain-source-kind-c1-survey_response");
    await waitFor(() => expect(survey).toHaveAttribute("data-closed", "true"));
    expect(survey).toHaveAttribute("title", "来源已关闭");
    expect(survey.className).toContain("opacity-50");
    const attachment = screen.getByTestId("project-brain-source-kind-c1-attachment");  // chat 开关管对话与附件两类
    expect(attachment).toHaveAttribute("data-closed", "true");
    const interview = screen.getByTestId("project-brain-source-kind-c1-interview_segment");
    expect(interview).not.toHaveAttribute("data-closed");
    expect(interview).not.toHaveAttribute("title");
    expect(screen.getByTestId("project-brain-claim-c1")).toHaveTextContent("并网周期是首要阻碍");
  });

  it("分享自个人记忆的结论不取来源、没有标签；AI 权限读失败 ⇒ 不乱标「已关闭」", async () => {
    fetchProjectKnowledge.mockResolvedValue({
      scope: SCOPE, revision: 3, objects: [], edges: [],
      claims: [claim("c1", "fact", "并网周期是首要阻碍"), claim("shared", "goal", "今年做完")],
      sharedFromPersonal: [{ claimId: "shared", sharedBy: "u2", sharedByName: "李四", sharedAt: "2026-09-27T00:00:00Z" }],
    });
    fetchClaimSources.mockResolvedValue(sources("c1", ["research_source"]));
    getProjectAiSettings.mockRejectedValue(new Error("network"));

    render(<ProjectBrainPanel projectId="p1" />);
    const research = await screen.findByTestId("project-brain-source-kind-c1-research_source");
    expect(research).toHaveTextContent("深研来源");
    expect(research).not.toHaveAttribute("data-closed");
    expect(fetchClaimSources).toHaveBeenCalledTimes(1);
    expect(fetchClaimSources).not.toHaveBeenCalledWith("shared");
    expect(screen.queryByTestId("project-brain-source-kinds-shared")).toBeNull();
  });
});
