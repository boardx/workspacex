/**
 * UC-17.8 B4.4 —— `deepenFeedback` 用例（`POST /feedback/:id/deepen`）。
 *
 * 三件事：
 *   1. 正常路径：`name`=反馈 `title`、`problem`=反馈 `detail`、`template` 恒 `"wireframe"`、
 *      `linkedFeedbackId` 回填。
 *   2. 幂等：同一条反馈第二次调用命中已有项目（`created: false`），不建第二个。
 *   3. 权限：D3 正文不可见（非提交人、非管理员）⇒ `FeedbackDetailNotVisibleError`；
 *      反馈不存在 ⇒ `FeedbackNotFoundError`。
 */
import { describe, expect, it } from "vitest";
import { FeedbackDetailNotVisibleError, deepenFeedback, type DeepenFeedbackDeps } from "../../src/application/feedback/deepen-feedback";
import { FeedbackNotFoundError } from "../../src/application/feedback/triage-feedback";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import { guard } from "../../src/application/security/permission-filter";
import { FakeDesignProjectRepo } from "../support/fake-design-project-repo";

function feedbackRow(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "导出按钮点击无响应",
    detail: guard({ kind: "feedback", id: "fb-1" }, "点了导出按钮没有任何反应，控制台也没有报错"),
    structured: guard({ kind: "feedback", id: "fb-1" }, null),
    status: "待处理",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    githubIssueUrl: null,
    githubIssueNumber: null,
    resolvedByDesignId: null,
    ...over,
  };
}

class FakeFeedbackRepo implements Pick<ProductFeedbackRepository, "findById"> {
  constructor(private readonly rows: Map<string, FeedbackRow>) {}
  async findById(feedbackId: string): Promise<FeedbackRow | null> {
    return this.rows.get(feedbackId) ?? null;
  }
}

function deps(rows: Map<string, FeedbackRow>, projects = new FakeDesignProjectRepo()): DeepenFeedbackDeps {
  let seq = 0;
  return {
    feedback: new FakeFeedbackRepo(rows) as unknown as ProductFeedbackRepository,
    projects,
    newDecisionId: () => `dec-${(seq += 1)}`,
    newProjectId: () => `dp-${(seq += 1)}`,
  };
}

describe("deepenFeedback -- 正常路径", () => {
  it("name=title, problem=detail, template=wireframe, linkedFeedbackId 回填", async () => {
    const rows = new Map([["fb-1", feedbackRow()]]);
    const d = deps(rows);
    const result = await deepenFeedback(d, {
      feedbackId: "fb-1",
      viewerId: "u-submitter",
      viewerOrgRole: "lead",
      viewerTeamId: null,
    });
    expect(result.created).toBe(true);
    expect(result.project.name).toBe("导出按钮点击无响应");
    expect(result.project.problem).toBe("点了导出按钮没有任何反应，控制台也没有报错");
    expect(result.project.template).toBe("wireframe");
    expect(result.project.linkedFeedbackId).toBe("fb-1");
    expect(result.project.ownerId).toBe("u-submitter");
  });

  it("管理员即使不是提交人也能深化（D3：管理员可读正文）", async () => {
    const rows = new Map([["fb-1", feedbackRow({ submittedBy: "u-someone-else" })]]);
    const d = deps(rows);
    const result = await deepenFeedback(d, {
      feedbackId: "fb-1",
      viewerId: "u-admin",
      viewerOrgRole: "admin",
      viewerTeamId: null,
    });
    expect(result.created).toBe(true);
    expect(result.project.ownerId).toBe("u-admin");
  });
});

describe("deepenFeedback -- 幂等", () => {
  it("同一条反馈重复调用命中已有项目，不建第二个", async () => {
    const rows = new Map([["fb-1", feedbackRow()]]);
    const projects = new FakeDesignProjectRepo();
    const d = deps(rows, projects);
    const first = await deepenFeedback(d, {
      feedbackId: "fb-1",
      viewerId: "u-submitter",
      viewerOrgRole: "lead",
      viewerTeamId: null,
    });
    const second = await deepenFeedback(d, {
      feedbackId: "fb-1",
      viewerId: "u-submitter",
      viewerOrgRole: "lead",
      viewerTeamId: null,
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.project.id).toBe(first.project.id);
    expect(projects.rows.size).toBe(1);
  });
});

describe("deepenFeedback -- 权限与存在性", () => {
  it("反馈不存在 -> FeedbackNotFoundError", async () => {
    const d = deps(new Map());
    await expect(
      deepenFeedback(d, { feedbackId: "fb-missing", viewerId: "u-1", viewerOrgRole: "lead", viewerTeamId: null }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("非提交人且非管理员 -> FeedbackDetailNotVisibleError（D3 正文不可见）", async () => {
    const rows = new Map([["fb-1", feedbackRow({ submittedBy: "u-submitter" })]]);
    const d = deps(rows);
    await expect(
      deepenFeedback(d, { feedbackId: "fb-1", viewerId: "u-bystander", viewerOrgRole: "lead", viewerTeamId: null }),
    ).rejects.toBeInstanceOf(FeedbackDetailNotVisibleError);
  });

  it("不是本组织成员（viewerOrgRole=null）-> FeedbackDetailNotVisibleError", async () => {
    const rows = new Map([["fb-1", feedbackRow({ submittedBy: "u-submitter" })]]);
    const d = deps(rows);
    await expect(
      deepenFeedback(d, { feedbackId: "fb-1", viewerId: "u-submitter", viewerOrgRole: null, viewerTeamId: null }),
    ).rejects.toBeInstanceOf(FeedbackDetailNotVisibleError);
  });
});
