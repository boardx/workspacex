/**
 * UC-17.8 B3.2 —— `listInbox` 聚合/排序/分页/过滤/`code` 编号/`github` 派生/
 * 非超管 withheld。全部用 fake 端口（同 `tests/feedback/triage-feedback.test.ts` 的写法），
 * 不碰真实数据库。
 */
import { describe, expect, it, vi } from "vitest";
import { listInbox, InboxPermissionRevokedError, INBOX_EXCEPTION_FETCH_CAP } from "../../src/application/inbox/list-inbox";
import type { ListInboxDeps, ListInboxInput } from "../../src/application/inbox/list-inbox";
import type { FeedbackRow, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import type { ErrorLogPort, ErrorLogListItem } from "../../src/application/ports/error-log.port";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";

function feedbackRow(over: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id: "fb-1",
    submittedBy: "u-submitter",
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "点了没反应",
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
    resolvedByDesignId: null,
    ...over,
  };
}

function fakeFeedbackRepo(rows: readonly FeedbackRow[]): ProductFeedbackRepository {
  return {
    insert: async () => undefined,
    list: async () => rows,
    findById: async () => null,
    setVote: async () => ({ votes: 0, votedByMe: false }),
    updateStatus: async () => undefined,
    appendStatusEvent: async () => undefined,
    transitionStatusWithEvent: async () => undefined,
    markStatusEventNotified: async () => undefined,
    transitionStatusWithEventIfCurrentStatus: async () => false,
    listStatusEvents: async () => [],
    setGithubIssue: async () => undefined,
    claimGithubIssueCreation: async () => false,
    releaseGithubIssueClaim: async () => undefined,
    counts: async () => ({ total: 0, 待处理: 0, 已进入迭代: 0, 已修复: 0, 不做: 0 }),
  } as unknown as ProductFeedbackRepository;
}

function errorLogItem(over: Partial<ErrorLogListItem> = {}): ErrorLogListItem {
  return {
    id: "1",
    traceId: "trace-1",
    msg: "boom",
    detail: { raw: "boom" },
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
    list: async ({ beforeId }) => {
      // 单页返回全部——测试数据量小，这里不模拟真实分页游标语义,只需满足
      // `fetchAllExceptions` 的循环终止条件(`hasMore=false`)。
      if (beforeId !== null) return { items: [], hasMore: false };
      return { items, hasMore: false };
    },
    getLifecycle: async () => null,
    updateLifecycle: async () => null,
  };
}

function baseDeps(
  rows: readonly FeedbackRow[],
  exceptions: readonly ErrorLogListItem[] | undefined,
  design: FakeDesignProjectRepo = new FakeDesignProjectRepo(),
): ListInboxDeps {
  return {
    feedback: {
      repo: fakeFeedbackRepo(rows),
      newDecisionId: () => "decision-1",
      orgId: toOrgId("org-1"),
      submitters: { emailForUserId: async () => null, displayNamesForUserIds: async () => new Map() },
    },
    errorLog: exceptions === undefined ? undefined : fakeErrorLog(exceptions),
    design: {
      projects: design,
      orgId: toOrgId("org-1"),
      submitters: { emailForUserId: async () => null, displayNamesForUserIds: async () => new Map() },
    },
  };
}

const adminInput: Omit<ListInboxInput, "limit"> = {
  viewerId: "u-admin",
  viewerOrgRole: "admin",
  viewerTeamId: null,
};

describe("listInbox 权限", () => {
  it("非管理员成员（consultant）能打开：看得到别人的标题/票数，正文按 D3 为 null（D8 ③）", async () => {
    const deps = baseDeps([feedbackRow({ id: "fb-1", submittedBy: "u-other" }), feedbackRow({ id: "fb-2", submittedBy: "u-me" })], undefined);
    const out = await listInbox(deps, { viewerId: "u-me", viewerOrgRole: "consultant", viewerTeamId: null, limit: 50 });
    const byId = new Map(out.items.map((i) => [i.id, i]));
    expect(byId.get("fb-1")?.title).toBe("点了没反应");
    expect(byId.get("fb-1")?.body).toBeNull();
    expect(byId.get("fb-2")?.body).toBe("正文");
    expect(out.sources.exception).toBe("withheld");
  });

  it("不是本组织成员（null）⇒ InboxPermissionRevokedError", async () => {
    const deps = baseDeps([feedbackRow()], []);
    await expect(
      listInbox(deps, { ...adminInput, viewerOrgRole: null, limit: 50 }),
    ).rejects.toBeInstanceOf(InboxPermissionRevokedError);
  });
});

describe("listInbox 聚合与排序", () => {
  it("两源按 createdAt 倒序合并，同刻按 kind 排序", async () => {
    const fb = feedbackRow({ id: "fb-1", createdAt: "2026-09-01T10:00:00.000Z" });
    const ex = errorLogItem({ id: "1", createdAt: "2026-09-01T10:00:00.000Z" });
    const older = feedbackRow({ id: "fb-0", createdAt: "2026-09-01T09:00:00.000Z" });
    const deps = baseDeps([fb, older], [ex]);

    const out = await listInbox(deps, { ...adminInput, limit: 50 });

    expect(out.items.map((i) => i.id)).toEqual(["1", "fb-1", "fb-0"]);
  });

  it("`code`：反馈按 kind（缺陷/需求）分别计数，系统异常全平台计数", async () => {
    const bug1 = feedbackRow({ id: "fb-bug-1", kind: "缺陷", createdAt: "2026-09-01T08:00:00.000Z" });
    const bug2 = feedbackRow({ id: "fb-bug-2", kind: "缺陷", createdAt: "2026-09-01T09:00:00.000Z" });
    const req1 = feedbackRow({ id: "fb-req-1", kind: "需求", createdAt: "2026-09-01T08:30:00.000Z" });
    const ex1 = errorLogItem({ id: "1", createdAt: "2026-09-01T07:00:00.000Z" });
    const ex2 = errorLogItem({ id: "2", createdAt: "2026-09-01T07:30:00.000Z" });
    const deps = baseDeps([bug1, bug2, req1], [ex1, ex2]);

    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    const byId = new Map(out.items.map((i) => [i.id, i.code]));

    expect(byId.get("fb-bug-1")).toBe("B-1");
    expect(byId.get("fb-bug-2")).toBe("B-2");
    expect(byId.get("fb-req-1")).toBe("R-1");
    expect(byId.get("1")).toBe("E-1");
    expect(byId.get("2")).toBe("E-2");
  });

  it("分页 cursor：第二页从第一页最后一条之后继续，不重复不遗漏", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      feedbackRow({ id: `fb-${i}`, createdAt: `2026-09-0${i + 1}T00:00:00.000Z` }),
    );
    const deps = baseDeps(rows, []);

    const page1 = await listInbox(deps, { ...adminInput, limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["fb-4", "fb-3"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listInbox(deps, { ...adminInput, limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(["fb-2", "fb-1"]);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await listInbox(deps, { ...adminInput, limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((i) => i.id)).toEqual(["fb-0"]);
    expect(page3.nextCursor).toBeNull();
  });
});

describe("listInbox 过滤", () => {
  it("`kind` 过滤单选", async () => {
    const deps = baseDeps([feedbackRow({ id: "fb-1" })], [errorLogItem({ id: "1" })]);
    const out = await listInbox(deps, { ...adminInput, limit: 50, kind: "exception" });
    expect(out.items.map((i) => i.kind)).toEqual(["exception"]);
  });

  it("`excludeKind: exception`（「全部」视图）⇒ 反馈 + 设计方案都在，系统异常一条不含，且在分页之前过滤", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => feedbackRow({ id: `fb-${i}`, createdAt: `2026-09-01T0${i}:00:00.000Z` }));
    const errors = Array.from({ length: 10 }, (_, i) => errorLogItem({ id: `${i}`, createdAt: `2026-09-02T0${i}:00:00.000Z` }));
    const deps = baseDeps(rows, errors);
    // limit=2：不带 excludeKind 时第一页全是更新的系统异常；带上后第一页就是反馈。
    const out = await listInbox(deps, { ...adminInput, limit: 2, excludeKind: "exception" });
    expect(out.items.map((i) => i.kind)).toEqual(["feedback", "feedback"]);
    expect(out.nextCursor).not.toBeNull();
    const page2 = await listInbox(deps, { ...adminInput, limit: 2, excludeKind: "exception", cursor: out.nextCursor! });
    expect(page2.items.map((i) => i.id)).toEqual(["fb-0"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("`stage` 过滤：`stageOf` 派生，不落库", async () => {
    const done = feedbackRow({ id: "fb-done", status: "已修复" });
    const backlog = feedbackRow({ id: "fb-backlog", status: "待处理" });
    const deps = baseDeps([done, backlog], []);
    const out = await listInbox(deps, { ...adminInput, limit: 50, stage: "done" });
    expect(out.items.map((i) => i.id)).toEqual(["fb-done"]);
  });

  it("`q` 只匹配 title 与 code，不搜正文（D3：正文对非管理员/非提交人隐藏也不该被搜到）", async () => {
    const row = feedbackRow({ id: "fb-1", title: "登录页崩溃", detail: guard({ kind: "feedback", id: "fb-1" }, "只有这段正文里有关键词 xyz") });
    const deps = baseDeps([row], []);

    const byTitle = await listInbox(deps, { ...adminInput, limit: 50, q: "崩溃" });
    expect(byTitle.items.map((i) => i.id)).toEqual(["fb-1"]);

    const byBody = await listInbox(deps, { ...adminInput, limit: 50, q: "xyz" });
    expect(byBody.items).toEqual([]);
  });

  it("`q` 命中 code（如 `B-1`）", async () => {
    const row = feedbackRow({ id: "fb-1", kind: "缺陷" });
    const deps = baseDeps([row], []);
    const out = await listInbox(deps, { ...adminInput, limit: 50, q: "B-1" });
    expect(out.items.map((i) => i.id)).toEqual(["fb-1"]);
  });
});

describe("listInbox 非超管 withheld", () => {
  it("errorLog 未注入（非超管）⇒ 结果不含 exception，sources.exception = withheld", async () => {
    const deps = baseDeps([feedbackRow({ id: "fb-1" })], undefined);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.sources.exception).toBe("withheld");
    expect(out.items.every((i) => i.kind !== "exception")).toBe(true);
  });

  it("errorLog 已注入（超管）⇒ sources.exception = included", async () => {
    const deps = baseDeps([], [errorLogItem({ id: "1" })]);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.sources.exception).toBe("included");
    expect(out.items.map((i) => i.kind)).toEqual(["exception"]);
  });
});

describe("listInbox severe 阈值", () => {
  it("同一 msg 出现次数达到阈值 ⇒ severe=true，未达到 ⇒ false", async () => {
    const many = Array.from({ length: 10 }, (_, i) => errorLogItem({ id: `${i + 1}`, msg: "重复异常" }));
    const rare = errorLogItem({ id: "99", msg: "偶发异常" });
    const deps = baseDeps([], [...many, rare]);

    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    const bySevere = new Map(out.items.map((i) => [i.id, i.severe]));
    expect(bySevere.get("1")).toBe(true);
    expect(bySevere.get("99")).toBe(false);
  });
});

describe("listInbox github 派生", () => {
  it("有 githubIssueUrl 且状态未终态 ⇒ open", async () => {
    const row = feedbackRow({ id: "fb-1", githubIssueUrl: "https://github.com/x/y/issues/1", githubIssueNumber: 1, status: "已进入迭代" });
    const deps = baseDeps([row], []);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.items[0]!.github).toEqual({ kind: "issue", number: 1, url: "https://github.com/x/y/issues/1", state: "open" });
  });

  it("已修复/不做 ⇒ closed", async () => {
    const row = feedbackRow({ id: "fb-1", githubIssueUrl: "https://github.com/x/y/issues/1", githubIssueNumber: 1, status: "已修复" });
    const deps = baseDeps([row], []);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.items[0]!.github?.state).toBe("closed");
  });

  it("没有 issue ⇒ null", async () => {
    const row = feedbackRow({ id: "fb-1" });
    const deps = baseDeps([row], []);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.items[0]!.github).toBeNull();
  });

  it("系统异常恒 null", async () => {
    const deps = baseDeps([], [errorLogItem({ id: "1" })]);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.items[0]!.github).toBeNull();
  });
});

describe("listInbox 接入 design（B4.3）", () => {
  it("只有 pushed=true 的项目出现，编号按创建顺序 D-n", async () => {
    const design = new FakeDesignProjectRepo();
    design.seed(designProjectRow({ id: "dp-old", pushed: true, createdAt: "2026-09-01T00:00:00.000Z" }));
    design.seed(designProjectRow({ id: "dp-new", pushed: true, createdAt: "2026-09-02T00:00:00.000Z" }));
    design.seed(designProjectRow({ id: "dp-draft", pushed: false, createdAt: "2026-09-03T00:00:00.000Z" }));

    const deps = baseDeps([], [], design);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });

    expect(out.items.map((i) => i.id)).not.toContain("dp-draft");
    const byId = new Map(out.items.map((i) => [i.id, i.code]));
    expect(byId.get("dp-old")).toBe("D-1");
    expect(byId.get("dp-new")).toBe("D-2");
  });

  it("stage 恒 backlog，kind=design，linkedFeedbackId 透传", async () => {
    const design = new FakeDesignProjectRepo();
    design.seed(designProjectRow({ id: "dp-1", pushed: true, linkedFeedbackId: "fb-3" }));
    const deps = baseDeps([], [], design);
    const out = await listInbox(deps, { ...adminInput, limit: 50 });
    expect(out.items[0]).toMatchObject({ kind: "design", stage: "backlog", linkedFeedbackId: "fb-3" });
  });

  it("`kind` 过滤能单独选出 design", async () => {
    const design = new FakeDesignProjectRepo();
    design.seed(designProjectRow({ id: "dp-1", pushed: true }));
    const deps = baseDeps([feedbackRow({ id: "fb-1" })], [], design);
    const out = await listInbox(deps, { ...adminInput, limit: 50, kind: "design" });
    expect(out.items.map((i) => i.id)).toEqual(["dp-1"]);
  });
});

/* ── UC-17.8 B6.4 可观测性：每次聚合一条结构化日志（fake logger 断言字段存在，不断言具体数值） ── */
describe("listInbox 可观测性（B6.4）", () => {
  function loggedFields(logger: { info: ReturnType<typeof vi.fn> }): Record<string, unknown> {
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toBe("inbox: listInbox aggregation");
    return fields;
  }

  it("三源行数 / 各源耗时 / 是否撞 cap / 返回条数 / 下一页 / traceId 都在同一条 info 里", async () => {
    const design = new FakeDesignProjectRepo();
    design.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", pushed: true, pushedAt: "2026-09-02T00:00:00.000Z" }));
    design.seed(designProjectRow({ id: "dp-2", ownerId: "u-1", pushed: false }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = { ...baseDeps([feedbackRow({ id: "fb-1" }), feedbackRow({ id: "fb-2" })], [errorLogItem()], design), logger, traceId: "trace-req-1" };

    const out = await listInbox(deps, { ...adminInput, limit: 2, q: "  " });

    const f = loggedFields(logger);
    expect(f).toMatchObject({
      traceId: "trace-req-1",
      op: "listInbox",
      orgId: "org-1",
      feedbackRows: 2,
      exceptionRows: 1,
      designRows: 2,
      exceptionSource: "included",
      exceptionCapHit: false,
      exceptionFetchCap: INBOX_EXCEPTION_FETCH_CAP,
      returned: 2,
      matched: 4,
      hasNextCursor: true,
      cursorPresent: false,
      kind: null,
      stage: null,
      qPresent: false,
      limit: 2,
    });
    for (const k of ["feedbackMs", "exceptionMs", "designMs", "durationMs"]) {
      expect(typeof f[k], k).toBe("number");
      expect(f[k] as number).toBeGreaterThanOrEqual(0);
    }
    expect(out.nextCursor).not.toBeNull();
  });

  it("非超管（errorLog 未注入）⇒ exceptionSource=withheld、exceptionRows=0，且不撞 cap", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    await listInbox({ ...baseDeps([feedbackRow()], undefined), logger }, { ...adminInput, limit: 50 });
    expect(loggedFields(logger)).toMatchObject({
      exceptionSource: "withheld",
      exceptionRows: 0,
      exceptionCapHit: false,
      traceId: "inbox-aggregate",
    });
  });

  it("系统异常源拉满 INBOX_EXCEPTION_FETCH_CAP 且源头还有更多 ⇒ exceptionCapHit=true（取舍边界被碰到的时刻可见）", async () => {
    let seq = 0;
    const endless: ErrorLogPort = {
      ...fakeErrorLog([]),
      list: async ({ limit }) => ({
        items: Array.from({ length: limit }, () => errorLogItem({ id: String(++seq) })),
        hasMore: true,
      }),
    };
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps: ListInboxDeps = { ...baseDeps([], []), errorLog: endless, logger };

    await listInbox(deps, { ...adminInput, limit: 10 });

    expect(loggedFields(logger)).toMatchObject({ exceptionCapHit: true, exceptionRows: INBOX_EXCEPTION_FETCH_CAP });
  });

  it("日志不含反馈正文 / 标题 / 提交人 / 搜索词原文（只有 qPresent 布尔）", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const deps = { ...baseDeps([feedbackRow({ title: "点了没反应" })], []), logger };
    await listInbox(deps, { ...adminInput, limit: 50, q: "点了" });
    const serialized = JSON.stringify(loggedFields(logger));
    expect(serialized).not.toContain("正文");
    expect(serialized).not.toContain("点了");
    expect(serialized).not.toContain("u-submitter");
    expect(loggedFields(logger)).toMatchObject({ qPresent: true });
  });

  it("logger 未注入（单测 / 无值班场景）⇒ 不抛、行为不变", async () => {
    const out = await listInbox(baseDeps([feedbackRow()], []), { ...adminInput, limit: 50 });
    expect(out.items).toHaveLength(1);
  });
});
