/**
 * F162 —— 五条限额策略路由的**授权面**。
 *
 * 这个文件是 `lint-permission-paths` 允许 `pg-limit-rule-repository.ts` 不走
 * `guard()/disclose()` 的**条件本身**（见该允许清单条目与
 * `permission-propagation-six-paths.test.ts` 里 49→50 那段论证）。
 *
 * ⚠ 每条被拒都同时断言**库里没有新规则 / 没有新事件**：只断言抛异常的话，
 * 一个「先写后判」的实现照样能过——它抛的异常是真的，写进去的行也是真的。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { PgLimitRuleRepository } from "../../src/infrastructure/auth/pg-limit-rule-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { OrgAdminManagementController } from "../../src/interface/controllers/org-admin-management.controller";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import {
  addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f162-authz";
const PROJECT = "proj-f162-authz";
const ADMIN = "u-f162a-admin";
const MEMBER = "u-f162a-member";
const OUTSIDER = "u-f162a-outsider";

let db: PgDatabase;
let controller: OrgAdminManagementController;

const HOOK_TIMEOUT_MS = 60_000;
const principal = (userId: string) => ({ userId, orgId: ORG }) as never;

const ruleCount = () =>
  asApp(ORG, (c) => c.query("SELECT 1 FROM limit_rules WHERE org_id=$1", [ORG]).then((r) => r.rows.length));

const body = {
  scopeKind: "member" as const, scopeRef: MEMBER, modelId: null,
  windowKind: "day" as const, thresholdTokens: 1000, action: "warn" as const,
  degradeToModelId: null,
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  controller = new OrgAdminManagementController(
    null as never, null as never, null as never, null as never, null as never,
    new PgIdentityRepository(db),
    null as never, null as never,
    new PgLimitRuleRepository(db),
    null as never,  // issue #852 delta：skill 审核人职能仓储：本文件不调那三条路由
  );
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(ADMIN, "admin@f162a.test", "管理员");
  await addCredential(MEMBER, "member@f162a.test", "顾问");
  await addCredential(OUTSIDER, "outsider@f162a.test", "外人");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

describe("F162 限额策略：五条路由都是 admin 门", () => {
  it("非本组织成员读规则 → 拒绝", async () => {
    await expect(controller.limitRules(ORG, principal(OUTSIDER))).rejects.toThrow(ForbiddenException);
  });

  it("组织内非管理员读规则 / 读事件 → FORBIDDEN", async () => {
    const err = await controller.limitRules(ORG, principal(MEMBER)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ reasonCode: "FORBIDDEN" });

    await expect(controller.limitEvents(ORG, principal(MEMBER))).rejects.toThrow(ForbiddenException);
  });

  it("非管理员建规则 → FORBIDDEN，且**库里没有新规则**", async () => {
    await expect(controller.createLimitRuleRoute(ORG, body, principal(MEMBER)))
      .rejects.toThrow(ForbiddenException);
    expect(await ruleCount()).toBe(0);
  });

  it("非管理员改/删规则 → FORBIDDEN，且那条规则原样还在", async () => {
    const { ruleId } = await controller.createLimitRuleRoute(ORG, body, principal(ADMIN));

    await expect(controller.updateLimitRuleRoute(ORG, ruleId, { enabled: false }, principal(MEMBER)))
      .rejects.toThrow(ForbiddenException);
    await expect(controller.deleteLimitRuleRoute(ORG, ruleId, principal(MEMBER)))
      .rejects.toThrow(ForbiddenException);

    const rules = await controller.limitRules(ORG, principal(ADMIN));
    expect(rules.rules).toHaveLength(1);
    expect(rules.rules[0]?.enabled).toBe(true);   // 没被那次越权的 PATCH 改掉
  });

  it("管理员：建 → 读回，比值由服务端给出", async () => {
    const { ruleId } = await controller.createLimitRuleRoute(ORG, body, principal(ADMIN));

    const out = await controller.limitRules(ORG, principal(ADMIN));
    expect(out.rules[0]).toMatchObject({ ruleId, thresholdTokens: 1000, usedRatio: 0 });
  });

  it("degrade 没给目标 → 400 DEGRADE_TARGET_REQUIRED，且没写进去", async () => {
    const err = await controller.createLimitRuleRoute(
      ORG, { ...body, action: "degrade" }, principal(ADMIN),
    ).catch((e: unknown) => e);

    expect((err as { getResponse?: () => unknown }).getResponse?.())
      .toMatchObject({ reasonCode: "DEGRADE_TARGET_REQUIRED" });
    expect(await ruleCount()).toBe(0);
  });
});
