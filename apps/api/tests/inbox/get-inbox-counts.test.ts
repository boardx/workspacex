/**
 * UC-17.8 B3.2 —— `getInboxCounts`：一次查询出 byStage/byKind/total，不受过滤影响，
 * 同一份 `sources` 规则。
 */
import { describe, expect, it } from "vitest";
import { getInboxCounts } from "../../src/application/inbox/get-inbox-counts";
import type { GetInboxCountsDeps } from "../../src/application/inbox/get-inbox-counts";
import { InboxPermissionRevokedError } from "../../src/application/inbox/list-inbox";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import type { ErrorLogPort, ErrorLogListItem } from "../../src/application/ports/error-log.port";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";

function feedbackRow(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "标题",
    detail: guard({ kind: "feedback", id: over.id ?? "fb-1" }, "正文"),
    structured: guard({ kind: "feedback", id: over.id ?? "fb-1" }, null),
    status: "待处理",
    statusReason: null,
    votes: 0,
    votedByMe: false,
    occurredRoute: null,
    appVersion: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    githubIssueUrl: null,
    githubIssueNumber: null,
    ...over,
  };
}

function fakeFeedbackRepo(rows: readonly FeedbackRow[]): ProductFeedbackRepository {
  return { list: async () => rows } as unknown as ProductFeedbackRepository;
}

function errorLogItem(over: Partial<ErrorLogListItem> = {}): ErrorLogListItem {
  return {
    id: "1",
    traceId: "t",
    msg: "boom",
    detail: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    aiTitle: null,
    aiSummary: null,
    status: "待处理",
    statusReason: null,
    devNote: null,
    tags: [],
    ...over,
  };
}

function fakeErrorLog(items: readonly ErrorLogListItem[]): ErrorLogPort {
  return {
    record: async () => undefined,
    list: async ({ beforeId }) => (beforeId !== null ? { items: [], hasMore: false } : { items, hasMore: false }),
    getLifecycle: async () => null,
    updateLifecycle: async () => null,
  };
}

function deps(rows: readonly FeedbackRow[], exceptions: readonly ErrorLogListItem[] | undefined): GetInboxCountsDeps {
  return {
    feedback: {
      repo: fakeFeedbackRepo(rows),
      newDecisionId: () => "d-1",
      orgId: toOrgId("org-1"),
      submitters: { emailForUserId: async () => null, displayNamesForUserIds: async () => new Map() },
    },
    errorLog: exceptions === undefined ? undefined : fakeErrorLog(exceptions),
  };
}

const admin = { viewerId: "u-admin", viewerOrgRole: "admin" as const, viewerTeamId: null };

describe("getInboxCounts 权限", () => {
  it("非分诊角色 ⇒ InboxPermissionRevokedError", async () => {
    await expect(
      getInboxCounts(deps([], []), { ...admin, viewerOrgRole: "consultant" }),
    ).rejects.toBeInstanceOf(InboxPermissionRevokedError);
  });
});

describe("getInboxCounts 聚合", () => {
  it("byStage/byKind/total 覆盖两源，且不受任何过滤影响（本身就没有过滤参数）", async () => {
    const rows = [
      feedbackRow({ id: "fb-1", kind: "缺陷", status: "待处理" }),
      feedbackRow({ id: "fb-2", kind: "需求", status: "已修复" }),
      feedbackRow({ id: "fb-3", kind: "缺陷", status: "不做" }),
    ];
    const exceptions = [errorLogItem({ id: "1", status: "待处理" }), errorLogItem({ id: "2", status: "已转入开发" })];

    const out = await getInboxCounts(deps(rows, exceptions), admin);

    expect(out.total).toBe(5);
    expect(out.byKind).toEqual({ feedback: 3, exception: 2, design: 0 });
    expect(out.byStage).toEqual({ backlog: 2, doing: 1, done: 1, archived: 1 });
  });

  it("design 恒为 0（本轮无数据）", async () => {
    const out = await getInboxCounts(deps([feedbackRow()], []), admin);
    expect(out.byKind.design).toBe(0);
  });
});

describe("getInboxCounts 非超管 withheld", () => {
  it("errorLog 未注入 ⇒ sources.exception=withheld，byKind.exception=0 且四列不含系统异常", async () => {
    const out = await getInboxCounts(deps([feedbackRow()], undefined), admin);
    expect(out.sources.exception).toBe("withheld");
    expect(out.byKind.exception).toBe(0);
  });

  it("errorLog 已注入 ⇒ sources.exception=included", async () => {
    const out = await getInboxCounts(deps([], [errorLogItem()]), admin);
    expect(out.sources.exception).toBe("included");
    expect(out.byKind.exception).toBe(1);
  });
});
