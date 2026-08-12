/**
 * F160 的拒绝路径 —— 不变量 I-Q1：逐人分配之和 ≤ 组织额度。
 *
 * 四条：
 *   1. 超分配 ⇒ `QUOTA_OVERALLOCATED`，响应带 `remainingTokens`，**且库里没写进去**；
 *   2. **并发反证**：两个管理员同时给两个不同的人提额，合计超过组织额度 ⇒
 *      恰好一条成功、一条被拒。这条是本文件存在的主要理由（见下）；
 *   3. 组织额度调低到低于已分配之和 ⇒ `BUDGET_BELOW_ALLOCATED`，不静默截断谁的额度；
 *   4. 给不在本组织的人设额度 ⇒ `MEMBER_NOT_FOUND`，不插一行没有主人的额度。
 *
 * ## 为什么并发那一条不能省
 *
 * 「先读组织额度、算一算、再写」这种写法在**单线程测试里永远是绿的**：第 1 条会过，
 * 第 3 条会过，界面点起来也完全正常。它唯一的失败面就是两个管理员同时点保存——
 * 那时两路各自读到同一个「还剩 6M」，各自判定通过，合计超发 2M，两条请求的日志
 * 都干干净净。所以 I-Q1 的证据必须是并发的那一条；没有它，`FOR UPDATE` 那一行
 * 可以被随手删掉而整个套件不变色。⚠ 见下方【互斥反证】的长注：第一版并发断言实测
 * 就是这样的空转，删掉锁照样绿——现在的版本是确定性的。
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTokenQuotaRepository } from "../../src/infrastructure/auth/pg-token-quota-repository";
import { setMemberTokenQuota, setOrgTokenBudget } from "../../src/application/auth/set-token-quota";
import { getTokenQuotas } from "../../src/application/auth/get-token-quotas";
import {
  BudgetBelowAllocatedError, MemberNotFoundError, QuotaOverallocatedError,
} from "../../src/application/auth/token-quota-ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f160-reject";
const PROJECT = "proj-f160-reject";
const ADMIN = "u-f160r-admin";
const LINKE = "u-f160r-linke";
const WUTONG = "u-f160r-wutong";
const OUTSIDER = "u-f160r-outsider";

let db: PgDatabase;
let repo: PgTokenQuotaRepository;

const orgId = () => toOrgId(ORG);
const setQuota = (userId: string, monthlyLimit: number) =>
  setMemberTokenQuota({ repo }, { orgId: orgId(), userId, monthlyLimit, actorUserId: ADMIN });
const setBudget = (monthlyBudget: number) =>
  setOrgTokenBudget({ repo }, { orgId: orgId(), monthlyBudget, actorUserId: ADMIN });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTokenQuotaRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(ADMIN, "admin@f160r.test", "管理员");
  await addCredential(LINKE, "linke@f160r.test", "林可");
  await addCredential(WUTONG, "wutong@f160r.test", "吴桐");
  await addCredential(OUTSIDER, "outsider@f160r.test", "外人");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, LINKE, "consultant", null);
  await addOrgMember(ORG, WUTONG, "consultant", null);
  await setBudget(10_000_000);
});

afterAll(async () => {
  await db.close();
});

describe("F160 I-Q1：逐人分配之和 ≤ 组织额度", () => {
  it("超分配被拒，带上「还剩多少可分」，且库里没写进去", async () => {
    await setQuota(LINKE, 6_000_000);

    const err = await setQuota(WUTONG, 5_000_000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(QuotaOverallocatedError);
    // 只说「超了」等于让管理员靠试——O-29⑤「阻断必须伴随可执行的下一步」。
    expect((err as QuotaOverallocatedError).remainingTokens).toBe(4_000_000);

    const after = await getTokenQuotas({ repo }, { orgId: orgId() });
    expect(after.allocated).toBe(6_000_000);
    expect(after.members.find((m) => m.userId === WUTONG)?.monthlyLimit).toBeNull();
  });

  /**
   * 【互斥反证】—— 这条测的是「调整额度**真的**取了组织级的锁」。
   *
   * ## 为什么不是「两个 Promise 一起跑，断言一成一败」
   *
   * 我先写的就是那一版：`Promise.allSettled([setQuota(A, 6M), setQuota(B, 6M)])`，
   * 断言恰好一成一败。然后按纪律做反证——**把 `pg_advisory_xact_lock` 和 `FOR UPDATE`
   * 两行都删掉重跑，它照样绿**（实测：`RESULTS ["ok","QuotaOverallocatedError"]`）。
   * 原因是两条链各自还要先跑一次 `isOrgMember` 事务，真实 I/O 的时序把它们错开了，
   * 危险窗口根本没被打开。也就是说那一版断言的是**调度的巧合**，不是锁——它绿不绿
   * 与那两行在不在毫无关系，正是本仓「全绿但空转」栽过九次的那种测试。
   *
   * ## 这一版怎么做到确定性
   *
   * 自己开一条连接、开事务、抢住同一把组织级 advisory 锁并**按住不放**，然后调
   * `setQuota`：它必须**阻塞**。等我提交后它才能继续。
   * 锁被删掉 ⇒ `setQuota` 立刻返回 ⇒ 这条当场变红，且每次都红，不看调度运气。
   */
  it("【互斥反证】调整额度会取组织级锁：别人按住锁时它必须等，锁一放才继续", async () => {
    const holder = new pg.Client(appConfig());
    await holder.connect();
    let settled = false;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ORG]);

      const pending = setQuota(LINKE, 6_000_000).then((r) => { settled = true; return r; });

      // 给它足够的时间跑完整条路径（本机上一次成功调整约 300ms 量级）。
      await new Promise((r) => setTimeout(r, 1_500));
      expect(settled).toBe(false);   // ← 锁不存在的话，这里早就 true 了

      await holder.query("COMMIT");
      await expect(pending).resolves.toMatchObject({ monthlyLimit: 6_000_000 });
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
  });

  it("串行的第二次提额被拒（互斥生效后的实际结果：合计不会超发）", async () => {
    await setQuota(LINKE, 6_000_000);
    await expect(setQuota(WUTONG, 6_000_000)).rejects.toBeInstanceOf(QuotaOverallocatedError);

    const after = await getTokenQuotas({ repo }, { orgId: orgId() });
    expect(after.allocated).toBe(6_000_000);
    expect(after.members.filter((m) => m.monthlyLimit !== null)).toHaveLength(1);
  });

  it("组织额度不得调到低于已分配之和：不静默截断谁的额度", async () => {
    await setQuota(LINKE, 6_000_000);
    await setQuota(WUTONG, 3_000_000);

    const err = await setBudget(5_000_000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BudgetBelowAllocatedError);
    expect((err as BudgetBelowAllocatedError).allocated).toBe(9_000_000);

    // 额度与逐人分配都原封不动——「谁被砍」是管理员要亲自做的决定。
    const after = await getTokenQuotas({ repo }, { orgId: orgId() });
    expect(after.orgBudget).toBe(10_000_000);
    expect(after.allocated).toBe(9_000_000);
  });

  it("给不在本组织的人设额度 ⇒ MEMBER_NOT_FOUND，不插一行没有主人的额度", async () => {
    const err = await setQuota(OUTSIDER, 1_000_000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MemberNotFoundError);

    const orphan = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM member_token_quota WHERE org_id=$1 AND user_id=$2", [ORG, OUTSIDER])
        .then((r) => r.rows.length),
    );
    expect(orphan).toBe(0);
  });

  it("组织额度未设置时不拦任何分配（未设置 = 不限额，delta §1.2 的取舍）", async () => {
    await asApp(ORG, (c) => c.query("DELETE FROM org_token_budget WHERE org_id=$1", [ORG]));

    await setQuota(LINKE, 999_000_000);

    const after = await getTokenQuotas({ repo }, { orgId: orgId() });
    expect(after.orgBudget).toBeNull();
    expect(after.allocated).toBe(999_000_000);
    expect(after.unallocated).toBeNull();
  });
});
