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
   * ⚠ 2026-09-02 迁移 `20260902130000_fb2_feedback_status_event_notified_patch`
   *   之前，`app_rw` 对这张表**没有任何** UPDATE 授权——第一层验的是 GRANT
   *   本身挡住了它，触发器根本没机会跑。现在 `app_rw` **有** UPDATE 授权（见
   *   `markStatusEventNotified` 需要的那条正当写路径），所以"改核心列"这个
   *   动作现在撞的是**触发器**，不再是 GRANT——两层验证因此都改成断言
   *   `/append-only/`；真正验证"GRANT 边界"的是下面新增的一条：只有
   *   notified/email_subject/email_text 这个形状的 UPDATE 才被放行，DELETE
   *   仍然没有授权。
   */
  it("④ 状态流水 append-only（第一层：app_rw 改核心列被触发器拒，DELETE 连 GRANT 都没有）", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asApp(ORG, (c) => c.query("UPDATE product_feedback_status_events SET reason = 'x' WHERE id = $1", ["ev-1"])),
    ).rejects.toThrow(/append-only/);
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

  /**
   * ④c 迁移 `20260902140000`（第三版,取代 `20260902130000` 那个只拿
   * `OLD.notified=false` 当哨兵的漏洞版本——见该迁移头注:`notified` 是业务
   * 布尔,`false` 是它的合法终态之一,不能兼职"这一行有没有被回填过"）:
   * `notification_settled_at` 专职"回填动作本身发生过没有",与最终 `notified`
   * 是 true 还是 false 无关;且**强制** `notified=false ⇒ subject/text 恒 NULL`。
   * 正反两面都要验,否则"开了个口子"读起来像开对了,实际上开成了"任何
   * UPDATE 都能过"或"只堵住了 true 那一条路径"。
   */
  it("④c 通知结果只能回填一次(true 分支)——正确形状放行，第二次回填被触发器拒", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    // 正确形状：app_rw 能把它从"从未回填过"回填成 notified:true + 文案 + settled。
    await asApp(ORG, (c) => c.query(
      `UPDATE product_feedback_status_events
          SET notified = true, email_subject = $2, email_text = $3, notification_settled_at = now()
        WHERE id = $1`,
      ["ev-1", "主题", "正文"],
    ));
    const after = await repo.listStatusEvents("fb-1");
    expect(after[0]).toMatchObject({ notified: true, emailSubject: "主题", emailText: "正文" });

    // 反证：同一行再回填一次被拒——`notification_settled_at` 已经非 NULL,
    // 不是靠 `notified` 恰好是 true 才挡住的。
    await expect(
      asApp(ORG, (c) => c.query(
        `UPDATE product_feedback_status_events
            SET notified = false, email_subject = NULL, email_text = NULL, notification_settled_at = now()
          WHERE id = $1`,
        ["ev-1"],
      )),
    ).rejects.toThrow(/append-only/);
  });

  it("④c 反证核心缺口①：notified 回填成 false 之后（邮件失败/无可通知邮箱），同一行仍然不能被再次回填", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    // 第一次回填：结果就是 false（邮件失败那条路径）——`notified` 的值本身
    // 没变,但 `notification_settled_at` 从 NULL 变成非 NULL,这次 UPDATE
    // 依然合法（这是这条迁移要修的那条口子：光看 `notified` 分不出"刚插入"
    // 和"回填成了 false"这两种状态）。
    await repo.markStatusEventNotified("ev-1", false, null, null);

    // 反证：再调一次（哪怕结果还是 false/null/null,形状与上次一模一样）
    // 必须被拒——`notification_settled_at` 已经非 NULL 了。
    await expect(
      asApp(ORG, (c) => c.query(
        `UPDATE product_feedback_status_events
            SET notified = false, email_subject = NULL, email_text = NULL, notification_settled_at = now()
          WHERE id = $1`,
        ["ev-1"],
      )),
    ).rejects.toThrow(/append-only/);
  });

  it("④c 反证核心缺口②：notified=false 却带着邮件正文这种损坏数据，数据库层直接拒绝，不只是信任调用方", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asApp(ORG, (c) => c.query(
        `UPDATE product_feedback_status_events
            SET notified = false, email_subject = '主题', email_text = '正文', notification_settled_at = now()
          WHERE id = $1`,
        ["ev-1"],
      )),
    ).rejects.toThrow(/append-only/);
  });

  it("④c 反证：即使只改 notified，只要**同时**碰了核心列，整个 UPDATE 仍被拒", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asApp(ORG, (c) => c.query(
        `UPDATE product_feedback_status_events
            SET notified = true, reason = 'x', notification_settled_at = now()
          WHERE id = $1`,
        ["ev-1"],
      )),
    ).rejects.toThrow(/append-only/);
  });

  it("④c 反证：漏传 notification_settled_at 的 UPDATE（即使其余形状都对）也被拒，不是悄悄没生效", async () => {
    await repo.insert(draft());
    await repo.appendStatusEvent({
      id: "ev-1", feedbackId: "fb-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: ME,
      notified: false, emailSubject: null, emailText: null,
    });
    await expect(
      asApp(ORG, (c) => c.query(
        "UPDATE product_feedback_status_events SET notified = true, email_subject = '主题', email_text = '正文' WHERE id = $1",
        ["ev-1"],
      )),
    ).rejects.toThrow(/append-only/);
  });

  /**
   * ④d `transitionStatusWithEvent`——状态变更与"这次转移发生过"这一行历史
   * 是**同一次调用**（同一个数据库事务，见 `ports.ts` 头注 2026-09-02 独立
   * 审查 P0）：落库时 `notified` 恒为 `false`（这一刻还没跑通知），
   * `markStatusEventNotified` 之后把真实结果回填进**同一行**。
   */
  it("④d transitionStatusWithEvent 原子改状态+写流水；markStatusEventNotified 回填同一行", async () => {
    await repo.insert(draft());
    await repo.transitionStatusWithEvent("fb-1", "已进入迭代", null, {
      id: "ev-1", feedbackId: "fb-1", fromStatus: "待处理", toStatus: "已进入迭代", reason: null, actorId: ME,
    });

    const afterTransition = await repo.findById("fb-1", ME);
    expect(afterTransition!.status).toBe("已进入迭代");
    const eventsAfterTransition = await repo.listStatusEvents("fb-1");
    expect(eventsAfterTransition).toEqual([
      expect.objectContaining({ id: "ev-1", toStatus: "已进入迭代", notified: false, emailSubject: null, emailText: null }),
    ]);

    await repo.markStatusEventNotified("ev-1", true, "主题", "正文");
    const eventsAfterNotify = await repo.listStatusEvents("fb-1");
    expect(eventsAfterNotify[0]).toMatchObject({ notified: true, emailSubject: "主题", emailText: "正文" });
    // 回填不动状态本身。
    expect((await repo.findById("fb-1", ME))!.status).toBe("已进入迭代");
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
