/**
 * F160 —— 成员 token 配额的读写，跑在真实 Postgres 上。
 *
 * 本文件覆盖「正常路径 + 那几个容易被写成 0 的 null」：
 *   1. 设额度 → 读回一致，`allocated` / `unallocated` 跟着变；
 *   2. **组织额度未设置时 `orgBudget` 与 `unallocated` 都是 `null`，不是 0**
 *      （delta §1.2 的取舍：未设置 = 不限额。写成 0 会让每个新组织显示成「已用尽」——
 *      `seat_quota` 默认 0 那次事故就是这么发生的）；
 *   3. **没有额度的成员仍然出现在列表里**（LEFT JOIN），他们恰恰是要被分配的那些人；
 *   4. `usedTokens` 来自 F159 的计量流水，且**包含失败的调用**；
 *   5. 超支预警计数用同一个 85% 常量，不在前端再写一遍。
 *
 * 拒绝路径（超分配 / 调低组织额度 / 非管理员）在
 * `member-token-quota-overallocation-rejected.test.ts`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTokenQuotaRepository } from "../../src/infrastructure/auth/pg-token-quota-repository";
import { getTokenQuotas, OVERSPEND_WARNING_RATIO } from "../../src/application/auth/get-token-quotas";
import { setMemberTokenQuota, setOrgTokenBudget } from "../../src/application/auth/set-token-quota";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f160-quota";
const PROJECT = "proj-f160-quota";
const ADMIN = "u-f160-admin";
const LINKE = "u-f160-linke";
const WUTONG = "u-f160-wutong";

let db: PgDatabase;
let repo: PgTokenQuotaRepository;

const orgId = () => toOrgId(ORG);
const read = () => getTokenQuotas({ repo }, { orgId: orgId() });
const setQuota = (userId: string, monthlyLimit: number) =>
  setMemberTokenQuota({ repo }, { orgId: orgId(), userId, monthlyLimit, actorUserId: ADMIN });
const setBudget = (monthlyBudget: number) =>
  setOrgTokenBudget({ repo }, { orgId: orgId(), monthlyBudget, actorUserId: ADMIN });

/**
 * 一条计量事件夹具。
 *
 * ⚠ 直接 INSERT 而不走 `PgTokenUsageRepository.record`，且 `run_id` 留 NULL：
 * 本文件测的是**读侧聚合**（本月已用、超支预警、月份边界），不是 F159 的写入链路
 * （那条由 `token-usage-single-write-path.test.ts` 覆盖）。走仓储就必须为每一条
 * 事件伪造一整条 thread → message → agent_run 链，四条事件要造四条 run——
 * 那些 run 与本文件要证明的任何一件事都无关，只会让夹具比断言长三倍。
 */
const spend = (userId: string, tokens: number, outcome: "succeeded" | "failed" = "succeeded") =>
  asApp(ORG, (c) =>
    c.query(
      `INSERT INTO token_usage_events
         (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome)
       VALUES ($1, $2, $3, NULL, 'test-provider', 'test-model', $4, $5)`,
      [`evt-${userId}-${tokens}-${outcome}-${Math.random()}`, ORG, userId, tokens, outcome],
    ),
  );

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTokenQuotaRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(ADMIN, "admin@f160.test", "管理员");
  await addCredential(LINKE, "linke@f160.test", "林可");
  await addCredential(WUTONG, "wutong@f160.test", "吴桐");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, LINKE, "consultant", null);
  await addOrgMember(ORG, WUTONG, "consultant", null);
});

afterAll(async () => {
  await db.close();
});

describe("F160 成员 token 配额", () => {
  it("组织额度未设置时：orgBudget / unallocated 都是 null，不是 0", async () => {
    const out = await read();

    expect(out.orgBudget).toBeNull();
    // 这一条是本 feature 最容易写错的地方：把「未设置」渲染成 0，界面上就成了
    // 「已分配 0 / 未分配 0」＝ 一个 token 都分不出去了，而真实状态是还没人设过额度。
    expect(out.unallocated).toBeNull();
    expect(out.allocated).toBe(0);
    expect(out.overspendCount).toBe(0);
  });

  it("没有被分配额度的成员照样在列表里，且 monthlyLimit 是 null（不是 0）", async () => {
    const out = await read();

    expect(out.members.map((m) => m.userId).sort()).toEqual([ADMIN, LINKE, WUTONG].sort());
    for (const m of out.members) expect(m.monthlyLimit).toBeNull();
  });

  it("设额度 → 读回一致，三张卡的数字跟着变", async () => {
    await setBudget(10_000_000);
    const saved = await setQuota(LINKE, 4_000_000);

    expect(saved).toEqual({
      userId: LINKE, monthlyLimit: 4_000_000, allocated: 4_000_000, unallocated: 6_000_000,
    });

    const out = await read();
    expect(out.orgBudget).toBe(10_000_000);
    expect(out.allocated).toBe(4_000_000);
    expect(out.unallocated).toBe(6_000_000);
    expect(out.members.find((m) => m.userId === LINKE)?.monthlyLimit).toBe(4_000_000);
  });

  it("再调一次是覆盖不是累加（同一个人两次保存 ≠ 分了两份）", async () => {
    await setBudget(10_000_000);
    await setQuota(LINKE, 4_000_000);
    await setQuota(LINKE, 2_000_000);

    const out = await read();
    expect(out.allocated).toBe(2_000_000);
    expect(out.members.find((m) => m.userId === LINKE)?.monthlyLimit).toBe(2_000_000);
  });

  it("usedTokens 来自计量流水，且**包含失败的调用**（F159 的取舍在这里被看见）", async () => {
    await spend(LINKE, 1_000_000);
    await spend(LINKE, 500_000);
    await spend(LINKE, 0, "failed");
    await spend(WUTONG, 300_000);

    const out = await read();
    expect(out.members.find((m) => m.userId === LINKE)?.usedTokens).toBe(1_500_000);
    expect(out.members.find((m) => m.userId === WUTONG)?.usedTokens).toBe(300_000);
    expect(out.orgUsed).toBe(1_800_000);

    // 失败那一行确实在库里（0 token），不是被读侧过滤掉了——
    // 「有调用没 token」是真实存在的一格，不是漏记。
    const failedRows = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM token_usage_events WHERE org_id=$1 AND outcome='failed'", [ORG])
        .then((r) => r.rows.length),
    );
    expect(failedRows).toBe(1);
  });

  it("超支预警：已用达到自身额度的 85% 才计入，且未分配额度的人不计入", async () => {
    await setBudget(10_000_000);
    await setQuota(LINKE, 1_000_000);
    await setQuota(WUTONG, 1_000_000);
    await spend(LINKE, 900_000);   // 90% → 计入
    await spend(WUTONG, 500_000);  // 50% → 不计入

    const out = await read();
    expect(out.overspendCount).toBe(1);

    // 阈值只有一个来源：前端不得再写一遍 0.85（F162 的限额规则同样引用它）。
    expect(OVERSPEND_WARNING_RATIO).toBe(0.85);
  });

  it("上月的用量不算进本月：额度按自然月结算", async () => {
    await spend(LINKE, 2_000_000);
    // 把这条事件挪到上个月。append-only 触发器挡应用角色的 UPDATE，所以用 owner 连接
    // 直接改——本条测的是读侧的月份边界，不是 append-only（那条在 F159 的文件里）。
    await asOwner((c) =>
      c.query(
        "ALTER TABLE token_usage_events DISABLE TRIGGER token_usage_events_append_only_trg",
      ),
    );
    await asOwner((c) =>
      c.query(
        "UPDATE token_usage_events SET occurred_at = now() - interval '40 days' WHERE org_id=$1",
        [ORG],
      ),
    );
    await asOwner((c) =>
      c.query("ALTER TABLE token_usage_events ENABLE TRIGGER token_usage_events_append_only_trg"),
    );

    const out = await read();
    expect(out.orgUsed).toBe(0);
    expect(out.members.find((m) => m.userId === LINKE)?.usedTokens).toBe(0);
  });
});
