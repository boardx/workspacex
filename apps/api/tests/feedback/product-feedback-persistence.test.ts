/**
 * FB-2 —— `product_feedback` 三张表在**真实 Postgres** 上的行为，即迁移
 * (`20260815140000_fb2_product_feedback.sql`) 声称的六条：
 *
 *   1. 写进去读得出来，判别联合的三种目标各自往返不失真。
 *   2. **票数是 `COUNT(*)`**（I-F2）：投票幂等（同一人两次不是两票），撤票真的减一。
 *   3. **本体只有 status / status_reason 可改**：改正文/标题/目标一律被触发器拒。
 *   4. **状态流水 append-only**：UPDATE / DELETE 两半都被拒。
 *   5. **「不做」必须带理由**是数据库约束，不只是用例里的一次判断。
 *   6. **RLS**：另一个租户读不到。
 *
 * ⚠ 第 3 / 4 / 5 条是这个文件存在的主要理由。用例层那几条判断在**单进程顺序调用**下
 *   看起来已经够了——而它们恰恰在并发、在直连 SQL、在「以后有人新写了一条路径」时失效，
 *   那三种情况在单元测试里都不会出现。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgProductFeedbackRepository } from "../../src/infrastructure/feedback/pg-product-feedback-repository";
import type { NewFeedback, ProductFeedbackRepository } from "../../src/application/feedback/ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-fb2-feedback";
const OTHER_ORG = "org-fb2-feedback-other";
const PROJECT = "proj-fb2-feedback";
const ME = "u-fb2-me";
const OTHER = "u-fb2-other";

let db: PgDatabase;
let repo: ProductFeedbackRepository;
let otherRepo: ProductFeedbackRepository;

function draft(over: Partial<NewFeedback> = {}): NewFeedback {
  return {
    id: "fb-1",
    submittedBy: ME,
    kind: "缺陷",
    target: { kind: "product" },
    targetLabel: null,
    title: "批准卡不记得上次的 token 预算",
    detail: "每次都要重填，第三次之后就不想用了。",
    occurredRoute: "/chat",
    appVersion: "2026.08.15",
    ...over,
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgProductFeedbackRepository(db).forOrg(ORG);
  otherRepo = new PgProductFeedbackRepository(db).forOrg(OTHER_ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(ORG, ME, "consultant", null);
  await addOrgMember(ORG, OTHER, "consultant", null);
});

describe("FB-2 落库", () => {
  it("① 三种目标各自往返不失真", async () => {
    await repo.insert(draft({ id: "fb-p", target: { kind: "product" } }));
    await repo.insert(draft({ id: "fb-a", target: { kind: "agent", agentId: "agent-7" }, targetLabel: "调研助手" }));
    await repo.insert(draft({ id: "fb-s", target: { kind: "skill", skillId: "skill-3" } }));

    const rows = await repo.list({ kind: "org" }, ME);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("fb-p")!.target).toEqual({ kind: "product" });
    expect(byId.get("fb-a")!.target).toEqual({ kind: "agent", agentId: "agent-7" });
    expect(byId.get("fb-a")!.targetLabel).toBe("调研助手");
    expect(byId.get("fb-s")!.target).toEqual({ kind: "skill", skillId: "skill-3" });
    expect(byId.get("fb-p")!.status).toBe("待处理");
    // I-F1：复现上下文分列存，读得回来。
    expect(byId.get("fb-p")!.occurredRoute).toBe("/chat");
    expect(byId.get("fb-p")!.appVersion).toBe("2026.08.15");
  });

  it("② 票数是 COUNT(*)：同一人投两次仍是 1 票，撤票真的减回去", async () => {
    await repo.insert(draft());
    expect(await repo.setVote("fb-1", ME, true)).toEqual({ votes: 1, votedByMe: true });
    expect(await repo.setVote("fb-1", ME, true)).toEqual({ votes: 1, votedByMe: true });
    expect((await repo.setVote("fb-1", OTHER, true)).votes).toBe(2);
    expect(await repo.setVote("fb-1", ME, false)).toEqual({ votes: 1, votedByMe: false });
  });

  it("② votedByMe 是**按请求者**算的，不是全局布尔", async () => {
    await repo.insert(draft());
    await repo.setVote("fb-1", OTHER, true);
    const mine = await repo.findById("fb-1", ME);
    const theirs = await repo.findById("fb-1", OTHER);
    expect(mine!.votes).toBe(1);
    expect(mine!.votedByMe).toBe(false);
    expect(theirs!.votedByMe).toBe(true);
  });

  it("③ 正文/标题/目标改不动 —— 触发器拒绝，不是靠调用方自觉", async () => {
    await repo.insert(draft());
    await expect(
      asApp(ORG, (c) => c.query("UPDATE product_feedback SET detail = 'tampered' WHERE id = $1", ["fb-1"])),
    ).rejects.toThrow(/only status\/status_reason are mutable/);
    await expect(
      asApp(ORG, (c) => c.query("UPDATE product_feedback SET target_kind = 'agent' WHERE id = $1", ["fb-1"])),
    ).rejects.toThrow();
  });

  it("③ 反证：status / status_reason 确实改得动（否则上一条是靠「什么都改不动」平凡通过的）", async () => {
    await repo.insert(draft());
    await repo.updateStatus("fb-1", "已进入迭代", null);
    expect((await repo.findById("fb-1", ME))!.status).toBe("已进入迭代");
  });

  /**
   * ④ 状态流水 append-only —— **两层**，逐层单独验。
   *
   * ⚠ 只验应用角色（app_rw）是不够的：它撞到的是 GRANT（`permission denied`），
   *   触发器根本没机会跑。那样的话触发器写错了也照样绿——绿的是 GRANT，不是触发器。
   *   所以第二半以 OWNER 身份跑：OWNER 绕过 GRANT，撞到的必然是触发器本身。
   */
  it("④ 状态流水 append-only（第一层：app_rw 连 GRANT 都没有）", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asApp(ORG, (c) => c.query("UPDATE product_feedback_status_events SET reason = 'x' WHERE id = $1", ["ev-1"])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(ORG, (c) => c.query("DELETE FROM product_feedback_status_events WHERE id = $1", ["ev-1"])),
    ).rejects.toThrow(/permission denied/);
  });

  it("④ 状态流水 append-only（第二层：连 OWNER 也被触发器拒）", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asOwner((c) => c.query("UPDATE product_feedback_status_events SET reason = 'x' WHERE id = $1", ["ev-1"])),
    ).rejects.toThrow(/append-only/);
    await expect(
      asOwner((c) => c.query("DELETE FROM product_feedback_status_events WHERE id = $1", ["ev-1"])),
    ).rejects.toThrow(/append-only/);
  });

  it("④b listStatusEvents 按时间正序读回完整流水，含通知快照（notified/subject/text）", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-created", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await repo.appendStatusEvent({
      id: "ev-triaged", feedbackId: "fb-1", fromStatus: "待处理", toStatus: "已进入迭代", reason: null, actorId: OTHER,
      notified: true, emailSubject: "你的反馈状态已更新为「已进入迭代」", emailText: "已经在跟了。",
    });

    const events = await repo.listStatusEvents("fb-1");
    expect(events.map((e) => e.id)).toEqual(["ev-created", "ev-triaged"]); // 时间正序
    expect(events[1]).toMatchObject({
      fromStatus: "待处理",
      toStatus: "已进入迭代",
      notified: true,
      emailSubject: "你的反馈状态已更新为「已进入迭代」",
      emailText: "已经在跟了。",
    });
    expect(events[0]).toMatchObject({ notified: false, emailSubject: null, emailText: null });
  });

  it("⑤ 「不做」没有理由存不进去 —— 这是 CHECK，不是用例层的一次判断", async () => {
    await repo.insert(draft());
    await expect(repo.updateStatus("fb-1", "不做", null)).rejects.toThrow();
    await expect(repo.updateStatus("fb-1", "不做", "   ")).rejects.toThrow();
    // 反证：给了理由就存得进去。
    await repo.updateStatus("fb-1", "不做", "与既有能力重复");
    expect((await repo.findById("fb-1", ME))!.statusReason).toBe("与既有能力重复");
  });

  it("⑥ RLS：另一个租户读不到，也数不到", async () => {
    await repo.insert(draft());
    expect(await otherRepo.findById("fb-1", ME)).toBeNull();
    expect(await otherRepo.list({ kind: "org" }, ME)).toEqual([]);
    expect((await otherRepo.counts()).total).toBe(0);
  });

  it("scope=mine 只回自己提的；scope=target 只回那个目标的", async () => {
    await repo.insert(draft({ id: "fb-mine", submittedBy: ME }));
    await repo.insert(draft({ id: "fb-theirs", submittedBy: OTHER }));
    await repo.insert(draft({ id: "fb-skill", target: { kind: "skill", skillId: "skill-3" } }));

    expect((await repo.list({ kind: "mine" }, ME)).map((r) => r.id).sort()).toEqual(["fb-mine", "fb-skill"]);
    expect(
      (await repo.list({ kind: "target", target: { kind: "skill", skillId: "skill-3" } }, ME)).map((r) => r.id),
    ).toEqual(["fb-skill"]);
  });

  it("counts 的四个分状态之和等于 total —— 一次查询派生的直接后果", async () => {
    await repo.insert(draft({ id: "fb-a" }));
    await repo.insert(draft({ id: "fb-b" }));
    await repo.updateStatus("fb-b", "已进入迭代", null);
    const c = await repo.counts();
    expect(c.待处理 + c.已进入迭代 + c.已修复 + c.不做).toBe(c.total);
    expect(c.total).toBe(2);
    expect(c.已进入迭代).toBe(1);
  });

  it("正文出门时被 Guarded 包着 —— 拿不到 `.payload`，只能经 discloseDecided 取", async () => {
    await repo.insert(draft());
    const row = (await repo.findById("fb-1", ME))!;
    // 载荷存在模块私有的 WeakMap 里；对象本身不带正文。
    expect(JSON.stringify(row.detail)).not.toContain("每次都要重填");
    expect(row.detail.ref).toEqual({ kind: "feedback", id: "fb-1" });
  });
});
