// workflow-event-github-projection.test.ts — H3A-039 的反证。
//
// 全部用构造的字符串/对象数据，不调用 gh CLI、不调用 GitHub API、不发真实
// 评论——同任务说明"验证阶段只做本地渲染 + dry-run"的边界要求。
import { describe, expect, it } from "vitest";
import {
  renderGithubStructuredComment,
  parseGithubStructuredComment,
  parseAllStructuredProjections,
  selectLatestStructuredProjection,
  projectionStreamKey,
  REVIEW_DECISION_PROJECTION_KIND,
  type GithubCommentLike,
} from "./workflow-event-github-projection";
import type { WorkflowEvent } from "./workflow-event-model";
import type { ReviewDecision } from "./review-decision-model";

function progressEvent(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    template_id: "TPL-EVT-001",
    template_version: 1,
    instance_id: "EVT-658-0007",
    task_id: "TSK-658-canvas-01",
    actor: "agt_01HXAMPLE",
    head_sha: "abcdef123456",
    evidence_refs: ["EVD-canvas-unit-0042"],
    sourceFile: ".harness/events/EVT-658-0007.yaml",
    kind: "progress",
    delta: { implemented: ["stableNodeId 映射已实现"] },
    blockers: [],
    next_action: { owner_role: "canvas-verifier", action: "verify_exact_sha" },
    ...overrides,
  } as WorkflowEvent;
}

function reviewDecision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    template_id: "TPL-RVW-001",
    template_version: 1,
    instance_id: "RVW-pr000-abcdef1",
    task_id: "TSK-658-canvas-01",
    reviewer: "agt_reviewer01",
    producer: "agt_producer01",
    exact_sha: "abcdef123456",
    decision: "approve",
    evidence_refs: ["EVD-canvas-unit-0042"],
    findings: [],
    sourceFile: ".harness/reviews/RVW-pr000-abcdef1.yaml",
    ...overrides,
  } as ReviewDecision;
}

describe("renderGithubStructuredComment + parseGithubStructuredComment 往返 (H3A-039)", () => {
  it("WorkflowEvent（progress）渲染出的评论含正确的结构化标记，解析函数能正确提取字段", () => {
    const event = progressEvent();
    const rendered = renderGithubStructuredComment(event, 7);

    // 标记行是第一行，机器字段齐全。
    expect(rendered.split("\n")[0]).toBe(
      "<!-- H3A-EVENT: template_id=TPL-EVT-001 instance_id=EVT-658-0007 kind=progress task_id=TSK-658-canvas-01 seq=7 -->",
    );
    // 复用 H3A-035 渲染出的人类可读正文也在（首行标题）。
    expect(rendered).toContain("TSK-658-canvas-01 · progress · abcdef1");

    const parsed = parseGithubStructuredComment(rendered);
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      templateId: "TPL-EVT-001",
      instanceId: "EVT-658-0007",
      kind: "progress",
      taskId: "TSK-658-canvas-01",
      seq: 7,
      streamKey: "TSK-658-canvas-01::progress",
    });
  });

  it("ReviewDecision 渲染出的评论含正确的结构化标记（合成 kind=review_decision），解析函数能正确提取", () => {
    const decision = reviewDecision();
    const rendered = renderGithubStructuredComment(decision, 3);

    expect(rendered.split("\n")[0]).toBe(
      "<!-- H3A-EVENT: template_id=TPL-RVW-001 instance_id=RVW-pr000-abcdef1 kind=review_decision task_id=TSK-658-canvas-01 seq=3 -->",
    );
    expect(rendered).toContain("reviewer：agt_reviewer01");
    expect(rendered).toContain("exact_sha：abcdef123456");

    const parsed = parseGithubStructuredComment(rendered);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe(REVIEW_DECISION_PROJECTION_KIND);
    expect(parsed?.instanceId).toBe("RVW-pr000-abcdef1");
    expect(parsed?.seq).toBe(3);
  });

  it("projectionStreamKey 对 WorkflowEvent 是 task_id::kind，对 ReviewDecision 是 task_id::review_decision", () => {
    expect(projectionStreamKey(progressEvent())).toBe("TSK-658-canvas-01::progress");
    expect(projectionStreamKey(reviewDecision())).toBe("TSK-658-canvas-01::review_decision");
  });
});

describe("parseGithubStructuredComment 面对人类闲聊评论 (H3A-039)", () => {
  it("没有标记的普通评论 → 判定为非结构化（null），不是硬报错", () => {
    expect(parseGithubStructuredComment("LGTM, 我这就去合并！👍")).toBeNull();
  });

  it("提到关键字但没有精确标记格式的评论 → 仍判 null，不做启发式猜测", () => {
    const fakeLooking = "这次 progress 事件的 instance_id 好像是 EVT-658-0007，kind 是 progress 吧？";
    expect(parseGithubStructuredComment(fakeLooking)).toBeNull();
  });

  it("标记字段被破坏（seq 不是合法整数）→ 判 null，不信任只解析出一半的标记", () => {
    const broken = "<!-- H3A-EVENT: template_id=TPL-EVT-001 instance_id=EVT-658-0007 kind=progress task_id=TSK-658-canvas-01 seq=not-a-number -->";
    expect(parseGithubStructuredComment(broken)).toBeNull();
  });

  it("空字符串 → null", () => {
    expect(parseGithubStructuredComment("")).toBeNull();
  });
});

describe("selectLatestStructuredProjection / parseAllStructuredProjections (H3A-039)", () => {
  it("从混杂评论（闲聊 + 结构化）里正确挑出 seq 最大的结构化事件，忽略闲聊", () => {
    const comments: GithubCommentLike[] = [
      { id: 1, body: "跟进一下，这个 PR 什么时候能合？" },
      { id: 2, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0001" }), 1) },
      { id: 3, body: "+1" },
      { id: 4, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0002" }), 2) },
      { id: 5, body: "辛苦了 🙏" },
      { id: 6, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0003" }), 3) },
    ];

    const latest = selectLatestStructuredProjection(comments);
    expect(latest).not.toBeNull();
    expect(latest?.instanceId).toBe("EVT-658-0003");
    expect(latest?.seq).toBe(3);
  });

  it("不是按评论数组顺序/created_at 决定最新——seq 更大的即使排在数组更前面也胜出", () => {
    const comments: GithubCommentLike[] = [
      { id: 1, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0099" }), 99) },
      { id: 2, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0002" }), 2) },
    ];
    const latest = selectLatestStructuredProjection(comments);
    expect(latest?.instanceId).toBe("EVT-658-0099");
    expect(latest?.seq).toBe(99);
  });

  it("同一 instance_id 出现两条评论（内容漂移场景）→ 去重后保留 seq 更大的那条", () => {
    const comments: GithubCommentLike[] = [
      { id: 1, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0007" }), 1) },
      { id: 2, body: renderGithubStructuredComment(progressEvent({ instance_id: "EVT-658-0007" }), 5) },
    ];
    const all = parseAllStructuredProjections(comments);
    expect(all).toHaveLength(1);
    expect(all[0]!.seq).toBe(5);
  });

  it("没有任何结构化评论 → 返回 null，不是错误", () => {
    const comments: GithubCommentLike[] = [
      { id: 1, body: "只是路过留个言" },
      { id: 2, body: "同上" },
    ];
    expect(selectLatestStructuredProjection(comments)).toBeNull();
    expect(parseAllStructuredProjections(comments)).toEqual([]);
  });

  it("空评论数组 → 返回 null", () => {
    expect(selectLatestStructuredProjection([])).toBeNull();
  });
});
