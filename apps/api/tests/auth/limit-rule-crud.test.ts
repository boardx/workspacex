/**
 * F162 —— 限额规则的增删改读 + 触发事件，真实 Postgres。
 *
 * 四条里有两条是**反证**：
 *
 *  · **枚举一份事实，三种语言**：`scope_kind` 的 CHECK 取值从 `pg_constraint` 读回来，
 *    与契约 `orgAdmin.LimitScopeKind` 断言集合相等。枚举漂移在这个仓库是会红的东西，
 *    不是靠人记得同步（同 `agent_run_steps_kind_check` 的既有做法）。
 *  · **删规则不删事件**：`limit_events` 对 `limit_rules` 是 `ON DELETE SET NULL`——
 *    删掉一条规则不该让「上个月他被降级过三次」从历史里消失。这条如果写成 CASCADE，
 *    所有别的用例照样全绿。
 *
 * 另外两条钉住「降级必须说降到哪」：创建时和改成 degrade 时**都**要拒，
 * 不因为后者是 PATCH 就放行——「降级」而不说目标 = 运行时静默换模型（I-28 的反面）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgAdmin as C } from "@repo/contracts";
import {
  addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgLimitRuleRepository } from "../../src/infrastructure/auth/pg-limit-rule-repository";
import {
  DegradeTargetRequiredError, LimitRuleNotFoundError,
} from "../../src/application/auth/token-quota-ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f162-rules";
const PROJECT = "proj-f162-rules";
const LINKE = "u-f162-linke";

let db: PgDatabase;
let repo: PgLimitRuleRepository;

const orgId = () => toOrgId(ORG);

const spend = (userId: string, tokens: number, modelId = "opus-4.6") =>
  asApp(ORG, (c) =>
    c.query(
      `INSERT INTO token_usage_events
         (id, org_id, user_id, run_id, model_provider, model_id, tokens_total, outcome)
       VALUES ($1,$2,$3,NULL,'test-provider',$4,$5,'succeeded')`,
      [`evt-${userId}-${tokens}-${Math.random()}`, ORG, userId, modelId, tokens],
    ),
  );

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgLimitRuleRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addCredential(LINKE, "linke@f162.test", "林可");
  await addOrgMember(ORG, LINKE, "consultant", null);
});

afterAll(async () => {
  await db.close();
});

describe("F162 限额规则 CRUD", () => {
  it("【反证】数据库的 scope_kind CHECK 取值 == 契约枚举（一份事实，三种语言）", async () => {
    const def = await asOwner((c) =>
      c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'limit_rules_scope_kind_check'`,
      ).then((r) => r.rows),
    );

    const inDb = [...(def[0]?.def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
    expect(inDb).toEqual([...C.LimitScopeKind.options].sort());
  });

  it("建 → 读回一致，含它自己窗口内的实测用量", async () => {
    await spend(LINKE, 900_000);

    const ruleId = await repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "month",
      thresholdTokens: 1_000_000, action: "warn", degradeToModelId: null,
    });

    const rules = await repo.listRules(orgId());
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      ruleId, scopeKind: "member", scopeRef: LINKE, thresholdTokens: 1_000_000,
      action: "warn", enabled: true, observedTokens: 900_000,
    });
  });

  it("每条规则按**自己的窗口**算用量，不是共用一个分子", async () => {
    await spend(LINKE, 500_000);
    // 一条按小时、一条按月：同一批事件下两条的观测值必须能不同。把上面那条挪到「本月内、
    // 一小时以前」，「按小时」的那条就该看不到它，而「按月」的那条仍然看得到。
    //
    // ⚠ 不用固定的 `interval '3 days'`——那要求测试运行时刻与「3 天前」落在同一个
    //   自然月，本月第 1-3 天运行必然假。改成 `LEAST('3 days', 距月初时长的一半)`：
    //   离月初足够远时逐字等价于原来的「3 天前」，月初这几天则自动收窄到一个更小、
    //   但仍然「在本月内、超过 1 小时」的偏移——月初头一两小时内运行仍是已知的极小
    //   残余窗口（`(now() - date_trunc('month', now())) / 2` 本身小于 1 小时时不满足
    //   「超过 1 小时」这条断言前提），不强行消灭，如实标注比假装万无一失更诚实。
    await asOwner((c) => c.query("ALTER TABLE token_usage_events DISABLE TRIGGER token_usage_events_append_only_trg"));
    await asOwner((c) => c.query(
      `UPDATE token_usage_events
         SET occurred_at = now() - LEAST(interval '3 days', (now() - date_trunc('month', now())) / 2)
       WHERE org_id=$1`,
      [ORG],
    ));
    await asOwner((c) => c.query("ALTER TABLE token_usage_events ENABLE TRIGGER token_usage_events_append_only_trg"));

    await repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "hour",
      thresholdTokens: 100_000, action: "warn", degradeToModelId: null,
    });
    await repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "month",
      thresholdTokens: 100_000, action: "warn", degradeToModelId: null,
    });

    const rules = await repo.listRules(orgId());
    const byWindow = Object.fromEntries(rules.map((r) => [r.windowKind, r.observedTokens]));
    expect(byWindow.hour).toBe(0);
    expect(byWindow.month).toBe(500_000);
  });

  it("action=degrade 但没给降级目标 ⇒ 拒绝（创建时）", async () => {
    await expect(repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "day",
      thresholdTokens: 1000, action: "degrade", degradeToModelId: null,
    })).rejects.toBeInstanceOf(DegradeTargetRequiredError);

    const rules = await repo.listRules(orgId());
    expect(rules).toHaveLength(0);   // 拒绝就是没写进去
  });

  it("改成 degrade 却没有目标 ⇒ 同样拒绝（不因为是 PATCH 就放行）", async () => {
    const ruleId = await repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "day",
      thresholdTokens: 1000, action: "warn", degradeToModelId: null,
    });

    await expect(repo.updateRule(orgId(), ruleId, { action: "degrade" }))
      .rejects.toBeInstanceOf(DegradeTargetRequiredError);

    const rules = await repo.listRules(orgId());
    expect(rules[0]?.action).toBe("warn");   // 原样，不是半改
  });

  it("改阈值/启停读回一致；改不存在的规则 ⇒ LIMIT_RULE_NOT_FOUND", async () => {
    const ruleId = await repo.createRule(orgId(), {
      scopeKind: "team", scopeRef: "team-x", modelId: null, windowKind: "week",
      thresholdTokens: 1000, action: "warn", degradeToModelId: null,
    });

    await repo.updateRule(orgId(), ruleId, { thresholdTokens: 5000, enabled: false });
    const rules = await repo.listRules(orgId());
    expect(rules[0]).toMatchObject({ thresholdTokens: 5000, enabled: false });

    await expect(repo.updateRule(orgId(), "no-such-rule", { enabled: true }))
      .rejects.toBeInstanceOf(LimitRuleNotFoundError);
    await expect(repo.deleteRule(orgId(), "no-such-rule"))
      .rejects.toBeInstanceOf(LimitRuleNotFoundError);
  });

  it("【反证】删规则**不删事件**：历史不因为配置被改而消失", async () => {
    const ruleId = await repo.createRule(orgId(), {
      scopeKind: "member", scopeRef: LINKE, modelId: null, windowKind: "day",
      thresholdTokens: 1000, action: "block", degradeToModelId: null,
    });
    await repo.recordEvent(orgId(), {
      ruleId, scopeKind: "member", subjectRef: LINKE, actionTaken: "block",
      observedTokens: 1200, thresholdTokens: 1000,
    });

    await repo.deleteRule(orgId(), ruleId);

    const events = await repo.listEvents(orgId(), 20);
    expect(events).toHaveLength(1);
    // 事件自带当时那条规则的快照：规则已不在，「当时阈值是 1000、观测 1200」仍然读得出来。
    expect(events[0]).toMatchObject({
      subjectRef: LINKE, actionTaken: "block", observedTokens: 1200, thresholdTokens: 1000,
    });
    expect(events[0]?.ruleId).toBe("");   // 规则已删 ⇒ 空串，不是把整行藏起来
  });

  it("agent 范围的规则：观测值恒 0 且如实（GAP-LIMIT-AGENT-SCOPE，不假装是 0% 用量）", async () => {
    await spend(LINKE, 900_000);
    await repo.createRule(orgId(), {
      scopeKind: "agent", scopeRef: "agent-scout", modelId: null, windowKind: "month",
      thresholdTokens: 1_000_000, action: "warn", degradeToModelId: null,
    });

    const rules = await repo.listRules(orgId());
    // 计量事件里没有 agent 维度，所以这条规则今天不可能触发——具名缺口，不是「用量真的是 0」。
    expect(rules[0]?.observedTokens).toBe(0);
  });
});
