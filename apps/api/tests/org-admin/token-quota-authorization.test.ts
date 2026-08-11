/**
 * F160 / F161 —— 四条 token 额度 / 用量路由的**授权面**，真实 Postgres + 真实 controller。
 *
 * 这个文件是 `lint-permission-paths` 允许 `pg-token-quota-repository.ts` 不走
 * `guard()`/`disclose()` 的**条件本身**：那条豁免的理由是「admin 门在 controller 里、
 * 在仓储被触达之前就跑完了」，而一条只写在允许清单里的理由是一句无人验证的话。
 * 所以这里逐条反证：
 *   · 非本组织成员 → `NO_ORG_MEMBERSHIP`；
 *   · 本组织的非管理员 → `FORBIDDEN`（额度是钱，`listMembers` 那条对普通成员开放的
 *     判定在这里**不适用**——两条授权面各判一次）；
 *   · 管理员 → 真的读到 / 真的写进去（独立 re-read 验证，不只看响应）。
 *
 * ⚠ 这四条被拒的断言必须同时验证**库里没变**：只断言抛异常，一个「先写后判」的实现
 * 照样能过——它抛的异常是真的，写进去的行也是真的。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { PgTokenQuotaRepository } from "../../src/infrastructure/auth/pg-token-quota-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import {
  addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f160-authz";
const PROJECT = "proj-f160-authz";
const ADMIN = "u-f160a-admin";
const MEMBER = "u-f160a-member";
const OUTSIDER = "u-f160a-outsider";

let db: PgDatabase;
let controller: OrgAdminManagementController;

const HOOK_TIMEOUT_MS = 60_000;
const principal = (userId: string) => ({ userId, orgId: ORG }) as never;

const quotaRowCount = () =>
  asApp(ORG, (c) =>
    c.query("SELECT 1 FROM member_token_quota WHERE org_id=$1", [ORG]).then((r) => r.rows.length));

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  controller = new OrgAdminManagementController(
    null as never, null as never, null as never, null as never, null as never,
    new PgIdentityRepository(db),
    null as never,
    new PgTokenQuotaRepository(db),
  );
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(ADMIN, "admin@f160a.test", "管理员");
  await addCredential(MEMBER, "member@f160a.test", "顾问");
  await addCredential(OUTSIDER, "outsider@f160a.test", "外人");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

describe("F160/F161 token 额度与用量：四条路由都是 admin 门", () => {
  it("非本组织成员读配额 → NO_ORG_MEMBERSHIP", async () => {
    await expect(controller.tokenQuotas(ORG, principal(OUTSIDER))).rejects.toThrow(ForbiddenException);
  });

  it("本组织的非管理员读配额 → FORBIDDEN（额度不随成员名单一起开放）", async () => {
    const err = await controller.tokenQuotas(ORG, principal(MEMBER)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ reasonCode: "FORBIDDEN" });
  });

  it("非管理员改别人的额度 → FORBIDDEN，且**库里没写进去**", async () => {
    await expect(
      controller.setTokenQuota(ORG, ADMIN, { monthlyLimit: 1_000_000 }, principal(MEMBER)),
    ).rejects.toThrow(ForbiddenException);

    // 只断言抛异常是不够的：「先写后判」的实现抛的异常是真的，写进去的行也是真的。
    expect(await quotaRowCount()).toBe(0);
  });

  it("非管理员改组织额度 → FORBIDDEN，且库里没有额度行", async () => {
    await expect(
      controller.setTokenBudget(ORG, { monthlyBudget: 9_000_000 }, principal(MEMBER)),
    ).rejects.toThrow(ForbiddenException);

    const budgets = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM org_token_budget WHERE org_id=$1", [ORG]).then((r) => r.rows.length));
    expect(budgets).toBe(0);
  });

  it("非管理员读用量 → FORBIDDEN", async () => {
    await expect(controller.usageReport(ORG, "week", principal(MEMBER))).rejects.toThrow(ForbiddenException);
  });

  it("未知统计窗口 → 400，而不是悄悄按本周算", async () => {
    // 悄悄按本周算的话，界面上「最近 5 小时」这个标签会配着一份本周的数字——
    // 一块看起来完全正常、却在说谎的屏。
    await expect(controller.usageReport(ORG, "last-fortnight", principal(ADMIN))).rejects.toThrow();
  });

  it("管理员：读得到、写得进，且写的是真库（独立 re-read）", async () => {
    await controller.setTokenBudget(ORG, { monthlyBudget: 10_000_000 }, principal(ADMIN));
    await controller.setTokenQuota(ORG, MEMBER, { monthlyLimit: 4_000_000 }, principal(ADMIN));

    const out = await controller.tokenQuotas(ORG, principal(ADMIN));
    expect(out.orgBudget).toBe(10_000_000);
    expect(out.members.find((m) => m.userId === MEMBER)?.monthlyLimit).toBe(4_000_000);

    const persisted = await asApp(ORG, (c) =>
      c.query<{ monthly_limit: string }>(
        "SELECT monthly_limit FROM member_token_quota WHERE org_id=$1 AND user_id=$2", [ORG, MEMBER],
      ).then((r) => r.rows));
    expect(persisted[0]?.monthly_limit).toBe("4000000");
  });
});
