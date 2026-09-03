/**
 * FB-2 补——反馈闭环反向对账在**真实 Postgres** 上的两条反证（PR #2580 独立复核
 * 阻断项①②，见 `pg-feedback-github-issue-scanner.ts` / `pg-product-feedback-repository.ts`
 * 的头注）：
 *
 *   1. `PgFeedbackGithubIssueScanner` 真的能跨组织读到候选（用两个不同的 org 各插一条
 *      符合条件的反馈,断言两条都出现),且返回的行里**没有 `detail`** 字段——单元测试
 *      的内存 fake 测不出 RLS/`SECURITY DEFINER` 的运行时行为,必须在真实数据库上验证。
 *   2. `transitionStatusWithEventIfCurrentStatus` 的"当前状态"前提在数据库层真的生效：
 *      当前状态已经被(模拟的)并发操作改变时，返回 `false`，不落库、不写事件。
 */
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgProductFeedbackRepository } from "../../src/infrastructure/feedback/pg-product-feedback-repository";
import { PgFeedbackGithubIssueScanner } from "../../src/infrastructure/feedback/pg-feedback-github-issue-scanner";
import type { NewFeedback, ProductFeedbackRepository } from "../../src/application/feedback/ports";
import type { FeedbackGithubIssueScanner } from "../../src/application/feedback/github-issue-poll-ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG_A = "org-fb2-poll-a";
const ORG_B = "org-fb2-poll-b";
const PROJECT_A = "proj-fb2-poll-a";
const PROJECT_B = "proj-fb2-poll-b";
const ME = "u-fb2-poll-me";

let db: PgDatabase;
let repoA: ProductFeedbackRepository;
let repoB: ProductFeedbackRepository;
let scanner: FeedbackGithubIssueScanner;

function draft(over: Partial<NewFeedback> = {}): NewFeedback {
  return {
    id: "fb-poll-1",
    submittedBy: ME,
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "对话历史丢了",
    detail: "刷新一下就没了,复现了三次。",
    occurredRoute: "/chat",
    appVersion: "2026.09.03",
    ...over,
  };
}

/** 反馈提交后直接就绪:转「已进入迭代」+ 挂上一个 GitHub issue 号,是本文件两条用例的共同前置。 */
async function seedIteratingWithIssue(
  repo: ProductFeedbackRepository,
  id: string,
  issueNumber: number,
): Promise<void> {
  await repo.insert(draft({ id }));
  await repo.transitionStatusWithEvent(id, "已进入迭代", null, {
    id: randomUUID(),
    feedbackId: id,
    fromStatus: "待处理",
    toStatus: "已进入迭代",
    reason: null,
    actorId: "u-fb2-poll-admin",
  });
  await repo.setGithubIssue(id, { url: `https://github.com/boardx/workspacex/issues/${issueNumber}`, number: issueNumber });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repoA = new PgProductFeedbackRepository(db).forOrg(ORG_A);
  repoB = new PgProductFeedbackRepository(db).forOrg(ORG_B);
  scanner = new PgFeedbackGithubIssueScanner(db);
});

beforeEach(async () => {
  await resetOrgs(ORG_A, ORG_B);
  await seedOrg({ orgId: ORG_A, projectId: PROJECT_A });
  await seedOrg({ orgId: ORG_B, projectId: PROJECT_B });
});

describe("PgFeedbackGithubIssueScanner —— 跨组织读", () => {
  it("看得到两个不同组织里各自的候选,且行里没有 detail", async () => {
    await seedIteratingWithIssue(repoA, "fb-poll-a", 101);
    await seedIteratingWithIssue(repoB, "fb-poll-b", 202);

    const candidates = await scanner.listOpenLinkedToGithubIssue();
    const byOrg = new Map(candidates.map((c) => [c.orgId, c]));

    expect(byOrg.has(ORG_A)).toBe(true);
    expect(byOrg.has(ORG_B)).toBe(true);
    expect(byOrg.get(ORG_A)).toMatchObject({ feedbackId: "fb-poll-a", githubIssueNumber: 101 });
    expect(byOrg.get(ORG_B)).toMatchObject({ feedbackId: "fb-poll-b", githubIssueNumber: 202 });
    // 结构性反证:返回的对象里没有 detail 这把钥匙——不是"有但是 null",是压根不存在。
    for (const c of candidates) expect(Object.keys(c)).not.toContain("detail");
  });

  it("不返回「已修复」或没有挂 issue 的反馈", async () => {
    await seedIteratingWithIssue(repoA, "fb-poll-open", 301);
    await repoA.insert(draft({ id: "fb-poll-no-issue" })); // 待处理,没挂 issue
    await repoA.insert(draft({ id: "fb-poll-fixed" }));
    await repoA.transitionStatusWithEvent("fb-poll-fixed", "已进入迭代", null, {
      id: randomUUID(), feedbackId: "fb-poll-fixed", fromStatus: "待处理", toStatus: "已进入迭代", reason: null, actorId: "u-fb2-poll-admin",
    });
    await repoA.setGithubIssue("fb-poll-fixed", { url: "https://github.com/boardx/workspacex/issues/999", number: 999 });
    await repoA.transitionStatusWithEvent("fb-poll-fixed", "已修复", null, {
      id: randomUUID(), feedbackId: "fb-poll-fixed", fromStatus: "已进入迭代", toStatus: "已修复", reason: null, actorId: "u-fb2-poll-admin",
    });

    const ids = (await scanner.listOpenLinkedToGithubIssue()).map((c) => c.feedbackId);
    expect(ids).toContain("fb-poll-open");
    expect(ids).not.toContain("fb-poll-no-issue");
    expect(ids).not.toContain("fb-poll-fixed");
  });
});

describe("transitionStatusWithEventIfCurrentStatus —— 并发前提", () => {
  it("当前状态吻合 ⇒ 写状态 + 写事件,返回 true", async () => {
    await seedIteratingWithIssue(repoA, "fb-poll-cas-ok", 401);
    const applied = await repoA.transitionStatusWithEventIfCurrentStatus("fb-poll-cas-ok", "已进入迭代", "已修复", null, {
      id: "ev-cas-ok", feedbackId: "fb-poll-cas-ok", fromStatus: "已进入迭代", toStatus: "已修复", reason: null, actorId: "system:test",
    });
    expect(applied).toBe(true);

    const row = await repoA.findById("fb-poll-cas-ok", ME);
    expect(row!.status).toBe("已修复");
    const events = await repoA.listStatusEvents("fb-poll-cas-ok");
    expect(events.some((e) => e.id === "ev-cas-ok")).toBe(true);
  });

  it("当前状态已经被(模拟的)并发操作改变 ⇒ 返回 false,不落库、不写事件", async () => {
    await seedIteratingWithIssue(repoA, "fb-poll-cas-race", 501);
    // 模拟"poller 读到快照之后,管理员抢先手动改判"——直接把状态改成不做。
    await repoA.transitionStatusWithEvent("fb-poll-cas-race", "不做", "重复反馈", {
      id: "ev-human-decline", feedbackId: "fb-poll-cas-race", fromStatus: "已进入迭代", toStatus: "不做", reason: "重复反馈", actorId: "u-fb2-poll-admin",
    });

    // poller 仍然拿着旧快照(以为当前状态是「已进入迭代」),尝试转「已修复」。
    const applied = await repoA.transitionStatusWithEventIfCurrentStatus("fb-poll-cas-race", "已进入迭代", "已修复", null, {
      id: "ev-cas-race", feedbackId: "fb-poll-cas-race", fromStatus: "已进入迭代", toStatus: "已修复", reason: null, actorId: "system:test",
    });
    expect(applied).toBe(false);

    // 人工判断原样保留,没有被 poller 覆盖。
    const row = await repoA.findById("fb-poll-cas-race", ME);
    expect(row!.status).toBe("不做");
    // poller 那次尝试没有留下任何痕迹——事件表里没有 ev-cas-race 这一行。
    const events = await repoA.listStatusEvents("fb-poll-cas-race");
    expect(events.some((e) => e.id === "ev-cas-race")).toBe(false);
  });
});
