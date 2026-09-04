/**
 * FB-2 —— `listFeedbackEvents` 用例：权限门（管理员，非「管理员 OR 提交人」）、
 * 存在性判定（404 而非 403，不泄露存在性）、happy path 原样透传仓储的流水。
 *
 * 全部用 fake 端口——不碰真实网络、不碰真实数据库（仓储也是内存 fake）。同
 * `get-feedback-github-issue.test.ts` 的纪律：这是应用层单测，断的是用例本身的
 * 分支，不是 HTTP/DB 集成（那需要真 Postgres，见 `product-feedback-persistence
 * .test.ts` ④b）。
 */
import { describe, expect, it, vi } from "vitest";
import { listFeedbackEvents, type ListFeedbackEventsDeps } from "../../src/application/feedback/list-feedback-events";
import { FeedbackNotFoundError, FeedbackTriageForbiddenError } from "../../src/application/feedback/triage-feedback";
import type { FeedbackRow, ProductFeedbackRepository, StatusEventRow } from "../../src/application/feedback/ports";
import { guard } from "../../src/application/security/permission-filter";

function row(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "点了没反应",
    detail: guard({ kind: "feedback", id: "fb-1" }, "反馈正文（本用例不读这个字段）"),
    structured: guard({ kind: "feedback", id: "fb-1" }, null),
    status: "已进入迭代",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-09-02T00:00:00.000Z",
    githubIssueUrl: null,
    githubIssueNumber: null,
    ...over,
  };
}

const EVENTS: readonly StatusEventRow[] = [
  {
    id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: "u-submitter",
    notified: false, emailSubject: null, emailText: null, createdAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "ev-2", feedbackId: "fb-1", fromStatus: "待处理", toStatus: "已进入迭代", reason: null, actorId: "u-admin",
    notified: true, emailSubject: "你的反馈状态已更新", emailText: "已经在跟了。", createdAt: "2026-09-02T00:00:00.000Z",
  },
];

function fakeRepo(current: FeedbackRow | null, events: readonly StatusEventRow[] = EVENTS): ProductFeedbackRepository {
  return {
    insert: vi.fn(),
    list: vi.fn(),
    findById: vi.fn(async () => current),
    setVote: vi.fn(),
    updateStatus: vi.fn(),
    appendStatusEvent: vi.fn(),
    listStatusEvents: vi.fn(async () => events),
    claimGithubIssueCreation: vi.fn(),
    releaseGithubIssueClaim: vi.fn(),
    setGithubIssue: vi.fn(),
    counts: vi.fn(),
  } as unknown as ProductFeedbackRepository;
}

const ADMIN = { actorId: "u-admin", actorOrgRole: "admin" as const };
const MEMBER = { actorId: "u-member", actorOrgRole: "lead" as const };
const SUBMITTER = { actorId: "u-submitter", actorOrgRole: null };

describe("listFeedbackEvents", () => {
  it("非管理员 ⇒ 403 语义（FeedbackTriageForbiddenError），且不碰仓储", async () => {
    const deps: ListFeedbackEventsDeps = { repo: fakeRepo(row()) };
    await expect(
      listFeedbackEvents(deps, { feedbackId: "fb-1", ...MEMBER }),
    ).rejects.toBeInstanceOf(FeedbackTriageForbiddenError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
  });

  /**
   * ⚠ 这条流水混着「谁经手过」（actorId），不是 D3 那套「管理员 OR 提交人」——
   * 提交人自己（哪怕组织角色是 null）也拿不到，见用例头注。
   */
  it("提交人本人（非管理员）⇒ 同样 403，不放宽——这条历史不是 D3 裁决的对象", async () => {
    const deps: ListFeedbackEventsDeps = { repo: fakeRepo(row()) };
    await expect(
      listFeedbackEvents(deps, { feedbackId: "fb-1", ...SUBMITTER }),
    ).rejects.toBeInstanceOf(FeedbackTriageForbiddenError);
    expect(deps.repo.findById).not.toHaveBeenCalled();
  });

  it("反馈不存在（或不在本组织，RLS 之后读到 null）⇒ FeedbackNotFoundError，不读流水", async () => {
    const deps: ListFeedbackEventsDeps = { repo: fakeRepo(null) };
    await expect(
      listFeedbackEvents(deps, { feedbackId: "fb-missing", ...ADMIN }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
    expect(deps.repo.listStatusEvents).not.toHaveBeenCalled();
  });

  it("成功 ⇒ 原样透传仓储的流水（含通知快照）", async () => {
    const deps: ListFeedbackEventsDeps = { repo: fakeRepo(row()) };
    const out = await listFeedbackEvents(deps, { feedbackId: "fb-1", ...ADMIN });
    expect(deps.repo.listStatusEvents).toHaveBeenCalledWith("fb-1");
    expect(out).toEqual(EVENTS);
  });
});
