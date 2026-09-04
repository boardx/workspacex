/**
 * `inbox` 契约束（UC-17.8 B3.1）——三件事：
 *   1. `stageOf` 是源状态 → stage 映射的**唯一实现**，全表逐格钉死（改映射 = 改这里 + 改文件头表）。
 *   2. `InboxItem` 形状正反例：`.strict()` 拒多余键、`code` 前缀闭集、「仅某类」字段的 null 语义。
 *   3. `listInbox.in` 的分页/搜索边界：limit 1..200、空 cursor 拒、q 上限。
 */
import { describe, expect, it } from "vitest";
import * as inbox from "../src/inbox";
import { FeedbackStatus } from "../src/feedback-loop";
import { SystemErrorStatus } from "../src/system-error-logs";

describe("stageOf -- 源状态到 stage 的唯一映射", () => {
  it.each([
    ["待处理", "backlog"],
    ["已进入迭代", "doing"],
    ["已修复", "done"],
    ["不做", "archived"],
  ] as const)("feedback %s -> %s", (status, stage) => {
    expect(inbox.stageOf("feedback", status)).toBe(stage);
  });

  it.each([
    ["待处理", "backlog"],
    ["已转入开发", "doing"],
    ["不做", "archived"],
  ] as const)("exception %s -> %s", (status, stage) => {
    expect(inbox.stageOf("exception", status)).toBe(stage);
  });

  it("两个源的每一个状态值都有映射（枚举加值时这里会红）", () => {
    for (const s of FeedbackStatus.options) expect(inbox.InboxStage.options).toContain(inbox.stageOf("feedback", s));
    for (const s of SystemErrorStatus.options) expect(inbox.InboxStage.options).toContain(inbox.stageOf("exception", s));
  });

  it("系统异常没有 done：三个源状态里没有任何一个落到 done", () => {
    const stages = SystemErrorStatus.options.map((s) => inbox.stageOf("exception", s));
    expect(stages).not.toContain("done");
  });

  it("design 本轮没有源状态：任何值都抛错，而不是返回默认列", () => {
    expect(() => inbox.stageOf("design", "待处理")).toThrow(/no mapping/);
  });

  it("串了源的状态值抛错（feedback 没有 已转入开发；exception 没有 已修复）", () => {
    expect(() => inbox.stageOf("feedback", "已转入开发")).toThrow();
    expect(() => inbox.stageOf("exception", "已修复")).toThrow();
  });

  it("stage 枚举顺序即看板列顺序", () => {
    expect(inbox.InboxStage.options).toEqual(["backlog", "doing", "done", "archived"]);
  });
});

const feedbackItem: inbox.InboxItem = {
  id: "fb-1",
  kind: "feedback",
  code: "B-3",
  title: "导出按钮无响应",
  body: "点导出没有任何反应",
  structured: { reproSteps: "1. 打开 2. 点导出" },
  feedbackKind: "缺陷",
  sourceStatus: "已进入迭代",
  stage: "doing",
  statusReason: null,
  severe: false,
  votes: 4,
  reporter: "张三",
  createdAt: "2026-09-04T08:00:00.000Z",
  github: { kind: "issue", number: 142, url: "https://github.com/o/r/issues/142", state: "open" },
  linkedFeedbackId: null,
  resolvedByDesignId: null,
  exception: null,
  submittedByMe: false,
  votedByMe: true,
};

const exceptionItem: inbox.InboxItem = {
  id: "9001",
  kind: "exception",
  code: "E-12",
  title: "登录回调 500",
  body: "TypeError: cannot read properties of undefined",
  structured: null,
  feedbackKind: null,
  sourceStatus: "待处理",
  stage: "backlog",
  statusReason: null,
  severe: true,
  votes: 0,
  reporter: null,
  createdAt: "2026-09-04T08:00:00.000Z",
  github: null,
  linkedFeedbackId: null,
  resolvedByDesignId: null,
  exception: { location: "/auth/callback", count: 12, affectedUsers: null },
  submittedByMe: false,
  votedByMe: false,
};

describe("InboxItem -- 正例", () => {
  it("反馈条目", () => {
    expect(inbox.InboxItem.safeParse(feedbackItem).success).toBe(true);
  });
  it("系统异常条目", () => {
    expect(inbox.InboxItem.safeParse(exceptionItem).success).toBe(true);
  });
  it("D3 无权看正文：body / structured / reporter 同时为 null 仍合法", () => {
    expect(
      inbox.InboxItem.safeParse({ ...feedbackItem, body: null, structured: null, reporter: null }).success,
    ).toBe(true);
  });
  it("四种编号前缀都合法", () => {
    for (const code of ["B-1", "R-20", "E-300", "D-4"]) {
      expect(inbox.InboxItem.safeParse({ ...feedbackItem, code }).success, code).toBe(true);
    }
  });
  it("github 徽标四种 state 都合法", () => {
    for (const state of ["open", "draft", "merged", "closed"] as const) {
      const r = inbox.InboxItem.safeParse({
        ...feedbackItem,
        github: { kind: "pr", number: 145, url: "https://github.com/o/r/pull/145", state },
      });
      expect(r.success, state).toBe(true);
    }
  });
});

describe("InboxItem -- 反例", () => {
  it("strict：多一个未声明的键即拒", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, tags: [] }).success).toBe(false);
  });
  it("code 前缀不在 B/R/E/D 闭集里即拒；缺连字符即拒", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, code: "X-1" }).success).toBe(false);
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, code: "B1" }).success).toBe(false);
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, code: "b-1" }).success).toBe(false);
  });
  it("kind 不在枚举里即拒", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, kind: "bug" }).success).toBe(false);
  });
  it("stage 不是四值之一即拒", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, stage: "待处理" }).success).toBe(false);
  });
  it("feedbackKind 不是 缺陷|需求 即拒", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, feedbackKind: "其他" }).success).toBe(false);
  });
  it("exception.count 必须 >= 1；exception 对象 strict", () => {
    expect(
      inbox.InboxItem.safeParse({ ...exceptionItem, exception: { ...exceptionItem.exception, count: 0 } }).success,
    ).toBe(false);
    expect(
      inbox.InboxItem.safeParse({ ...exceptionItem, exception: { ...exceptionItem.exception, level: "error" } })
        .success,
    ).toBe(false);
  });
  it("votes 不许为负；github.number 必须为正整数", () => {
    expect(inbox.InboxItem.safeParse({ ...feedbackItem, votes: -1 }).success).toBe(false);
    expect(
      inbox.InboxItem.safeParse({ ...feedbackItem, github: { ...feedbackItem.github, number: 0 } }).success,
    ).toBe(false);
  });
  it("缺任何一个必填键即拒（linkedFeedbackId 必须显式给 null，不能省略）", () => {
    const { linkedFeedbackId: _omit, ...rest } = feedbackItem;
    expect(inbox.InboxItem.safeParse(rest).success).toBe(false);
  });
});

describe("listInbox.in -- query 边界", () => {
  const schema = inbox.operations.listInbox.in;

  it("空 query 合法（全部默认）", () => {
    expect(schema.safeParse({}).success).toBe(true);
  });
  it("全字段合法", () => {
    expect(
      schema.safeParse({ kind: "feedback", stage: "backlog", q: "B-3", limit: 200, cursor: "abc" }).success,
    ).toBe(true);
  });
  it("limit 边界：1 与 200 通过，0 与 201 拒，小数拒", () => {
    expect(schema.safeParse({ limit: 1 }).success).toBe(true);
    expect(schema.safeParse({ limit: inbox.INBOX_LIST_MAX_LIMIT }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: inbox.INBOX_LIST_MAX_LIMIT + 1 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
  });
  it("默认页大小常量在上限之内", () => {
    expect(inbox.INBOX_LIST_DEFAULT_LIMIT).toBeLessThanOrEqual(inbox.INBOX_LIST_MAX_LIMIT);
  });
  it("cursor 空字符串拒（不透明但不能为空）", () => {
    expect(schema.safeParse({ cursor: "" }).success).toBe(false);
  });
  it("q 超过 200 字拒", () => {
    expect(schema.safeParse({ q: "x".repeat(200) }).success).toBe(true);
    expect(schema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
  it("kind / stage 只认枚举值；未知键拒", () => {
    expect(schema.safeParse({ kind: "缺陷" }).success).toBe(false);
    expect(schema.safeParse({ stage: "todo" }).success).toBe(false);
    expect(schema.safeParse({ status: "backlog" }).success).toBe(false);
  });
});

describe("操作形状", () => {
  it("两个操作都是 GET、无路径参数、错误码都在 InboxError 里", () => {
    for (const op of Object.values(inbox.operations)) {
      expect(op.method).toBe("GET");
      expect(op.path).not.toContain(":");
      for (const e of op.err) expect(inbox.InboxError.options).toContain(e);
    }
  });
  it("listInbox.out：sources.exception 只有 included|withheld", () => {
    const out = inbox.operations.listInbox.out;
    expect(out.safeParse({ items: [], nextCursor: null, sources: { exception: "withheld" } }).success).toBe(true);
    expect(out.safeParse({ items: [], nextCursor: null, sources: { exception: "hidden" } }).success).toBe(false);
  });
  it("getInboxCounts.out 覆盖四个 stage 与三个 kind", () => {
    const out = inbox.operations.getInboxCounts.out;
    const ok = {
      byStage: { backlog: 1, doing: 2, done: 3, archived: 4 },
      byKind: { feedback: 10, exception: 0, design: 0 },
      total: 10,
      sources: { exception: "included" },
    };
    expect(out.safeParse(ok).success).toBe(true);
    expect(out.safeParse({ ...ok, byStage: { backlog: 1, doing: 2, done: 3 } }).success).toBe(false);
  });
});
