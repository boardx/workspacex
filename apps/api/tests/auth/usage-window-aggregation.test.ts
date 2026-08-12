/**
 * F161 —— 「用量监控」的四个窗口**各自是一次真实聚合**。
 *
 * 这个 feature 存在的全部理由，是 `usage-monitor-tab.tsx` 自己的文件头注释里那句
 * 逐字自白：「窗口切换只影响本地展示态（无后端），不真正拉取不同窗口的数据——
 * mock 定死一份「本周」快照」。所以本文件的核心断言只有一条形状：
 * **同一批事件，不同窗口必须给出不同的数**。一个「换窗口不换数」的实现能通过
 * 任何单窗口断言，却通不过这条。
 *
 * 另外三条都对应一种会让界面骗人的写法：
 *  · 矩阵的列写死（原型里是五个固定模型名）⇒ 组织换了模型后显示五个空列；
 *  · 零事件时给出示例数字而不是空态；
 *  · 失败调用被读侧过滤掉 ⇒ 「调用数」与计量流水对不上。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTokenQuotaRepository } from "../../src/infrastructure/auth/pg-token-quota-repository";
import { getUsageReport } from "../../src/application/auth/get-usage-report";
import type { UsageWindowKey } from "../../src/application/auth/token-quota-ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f161-usage";
const PROJECT = "proj-f161-usage";
const LINKE = "u-f161-linke";
const WUTONG = "u-f161-wutong";

let db: PgDatabase;
let repo: PgTokenQuotaRepository;

const report = (window: UsageWindowKey) =>
  getUsageReport({ repo }, { orgId: toOrgId(ORG), window });

/** 一条计量事件，`agoHours` 小时以前。 */
async function spend(
  userId: string, modelId: string, tokens: number, agoHours = 0,
  outcome: "succeeded" | "failed" = "succeeded",
): Promise<void> {
  const id = `evt-${userId}-${modelId}-${tokens}-${agoHours}-${outcome}`;
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO token_usage_events
         (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome, occurred_at)
       VALUES ($1,$2,$3,NULL,'test-provider',$4,$5,$6, now() - ($7 || ' hours')::interval)`,
      [id, ORG, userId, modelId, tokens, outcome, String(agoHours)],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTokenQuotaRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(LINKE, "linke@f161.test", "林可");
  await addCredential(WUTONG, "wutong@f161.test", "吴桐");
  await addOrgMember(ORG, LINKE, "consultant", null);
  await addOrgMember(ORG, WUTONG, "consultant", null);
});

afterAll(async () => {
  await db.close();
});

describe("F161 用量监控：每个窗口是一次真实聚合", () => {
  it("【核心】同一批事件，最近 5 小时 / 本月 给出不同的数（换窗口就是换查询）", async () => {
    await spend(LINKE, "opus-4.6", 1_000_000, 1);      // 1 小时前 → 两个窗口都算
    await spend(LINKE, "opus-4.6", 5_000_000, 24 * 10); // 10 天前 → 只有本月算

    const recent = await report("5h");
    const month = await report("month");

    expect(recent.totalTokens).toBe(1_000_000);
    expect(month.totalTokens).toBe(6_000_000);
    // 一个「换窗口不换数」的实现在这里必红——它两次会返回同一个数。
    expect(recent.totalTokens).not.toBe(month.totalTokens);
  });

  it("矩阵的列来自窗口内真实出现过的模型，按用量降序，不是写死的五列", async () => {
    await spend(LINKE, "sonnet-4.6", 300_000, 1);
    await spend(LINKE, "opus-4.6", 900_000, 1);
    await spend(WUTONG, "opus-4.6", 100_000, 1);

    const out = await report("5h");

    expect(out.models).toEqual(["opus-4.6", "sonnet-4.6"]);   // 1.0M > 0.3M
    const linke = out.rows.find((r) => r.userId === LINKE);
    expect(linke?.perModel).toEqual([900_000, 300_000]);      // 与 models 同序等长
    expect(linke?.total).toBe(1_200_000);
    const wutong = out.rows.find((r) => r.userId === WUTONG);
    expect(wutong?.perModel).toEqual([100_000, 0]);           // 没用过的模型是 0，不是缺列
    expect(out.rows[0]?.userId).toBe(LINKE);                  // 行按总量降序
  });

  it("占比由服务端算，且窗口内总量为 0 时是 0 不是 NaN", async () => {
    await spend(LINKE, "opus-4.6", 750_000, 1);
    await spend(LINKE, "sonnet-4.6", 250_000, 1);

    const out = await report("5h");
    expect(out.distribution).toEqual([
      { modelId: "opus-4.6", tokens: 750_000, share: 0.75 },
      { modelId: "sonnet-4.6", tokens: 250_000, share: 0.25 },
    ]);

    // 只有失败调用（0 token）时：有调用数，但总量为 0——share 必须是 0，不能是 NaN。
    await asOwner((c) => c.query("ALTER TABLE token_usage_events DISABLE TRIGGER token_usage_events_append_only_trg"));
    await asOwner((c) => c.query("DELETE FROM token_usage_events WHERE org_id=$1", [ORG]));
    await asOwner((c) => c.query("ALTER TABLE token_usage_events ENABLE TRIGGER token_usage_events_append_only_trg"));
    await spend(LINKE, "opus-4.6", 0, 1, "failed");

    const zero = await report("5h");
    expect(zero.totalTokens).toBe(0);
    expect(zero.distribution[0]?.share).toBe(0);
    expect(Number.isNaN(zero.distribution[0]?.share)).toBe(false);
  });

  it("零事件 ⇒ 空数组与全 0，不是示例数字", async () => {
    const out = await report("week");

    expect(out.models).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.distribution).toEqual([]);
    expect(out.totalTokens).toBe(0);
    expect(out.activeMemberCount).toBe(0);
  });

  it("失败调用计入调用数（且单独可见），不被读侧悄悄过滤", async () => {
    await spend(LINKE, "opus-4.6", 500_000, 1);
    await spend(LINKE, "opus-4.6", 0, 1, "failed");

    const out = await report("5h");
    expect(out.callCount).toBe(2);
    expect(out.failedCallCount).toBe(1);
    expect(out.totalTokens).toBe(500_000);   // 失败不贡献 token，但贡献一次调用
  });

  it("activeMemberCount 是窗口内真有调用的人数，不是组织成员数", async () => {
    await spend(LINKE, "opus-4.6", 100_000, 1);

    const out = await report("5h");
    expect(out.activeMemberCount).toBe(1);   // 组织里有两名成员
  });
});
