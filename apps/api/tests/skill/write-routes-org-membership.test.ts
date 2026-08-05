/**
 * #532 —— 两条**写**路由（`POST /skills`、`POST /skills/:skillId/disable`）的
 * **成员资格**门禁存在性检查，打真实 PostgreSQL。
 *
 * ## 与 #521 / #527 不是同一形状
 *
 * `listSkills` / `getSkillDetail`（读路径）是「接线接错」——`orgRole` 取到了、
 * 可能被静默回退。这两条是「**这一层压根不存在**」：
 *
 *   ① `create` 里 `membership` 只喂给 `ownerTeamId`（`skill.controller.ts:157`），
 *      `membership === null` 从不导致拒绝。`assertOwnTenant` 只比
 *      `body.orgId === principal.orgId` —— 那是**租户**校验，不是**成员资格**。
 *      `SubmitterGrantsPort` 是数据范围上界（`dataScope: []` 时恒过），不是准入。
 *   ② `disable` 全文一次都没取 `membership`。今天靠状态机 R7 / 引用清单必然拒绝
 *      挡着——但**那道拒绝来自状态机而不是授权**，评审路径一落地这层就是缺的。
 *
 * ## 断言打在「拒绝来自哪一层」，不只是「有没有被拒」
 *
 * `disable` 那条尤其：一条只断言 `response.status >= 400` 的测试，在**没有**授权层
 * 的今天就是绿的（422 `REFERENCES_NOT_ENUMERATED` 也 >= 400）。所以这里逐字断言
 * `403` + `PERMISSION_REVOKED`，并**显式排除** `REFERENCES_NOT_ENUMERATED` /
 * `SKILL_VERSION_CHANGED`——那两个码出现，就说明挡住它的还是状态机。
 *
 * ## 每条「不许写」都配一条「许写」
 *
 * 否则一个「谁都写不了」的实现——路由整体 500、守卫写成恒拒、fixture 没建出 org——
 * 会让本文件全绿。配对用**同一条路径、同一份请求体**，只换发起人：
 *   - `create`：在册成员 ⇒ 201，且库里真的多了一行。
 *   - `disable`：在册成员 ⇒ **不是 403**，而是 422 `REFERENCES_NOT_ENUMERATED`
 *     （R7 第一道门）。这条同时钉住「授权层排在状态机之前、且没有把合法路径堵死」。
 *
 * ⚠ 本文件**不做**任何 `GRANT` / `REVOKE`：vitest 并行跑同一个 Postgres，对共享角色的
 *   无限定权限变更会把无关文件的 fixture 撞挂。移除成员资格用的是限定到本文件自有
 *   org 的一条 `DELETE`（同 `list-skills-org-membership.test.ts`）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

/** 本文件自有的 org id —— `resetOrgs` 按 org 限定清理，不得与别的文件重名。 */
const ORG = "org-i532-skill-write-authz";
/** 一直在册的成员：既建数据，也充当配对断言的「许写」那一侧。 */
const INSIDER = "u-i532-insider";
/** 曾是成员、被移出组织，但会话还在手上的人。 */
const EX_MEMBER = "u-i532-ex-member";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

/** 同 `skill-contract-crud.test.ts`：不申请任何数据范围，否则会被正确判成越权——
 *  那样红的是 `DATA_SCOPE_EXCEEDS_SUBMITTER`，与成员资格无关。 */
const CONTRACT = {
  promptTemplate: "把访谈纪要压成三条结论",
  inputSchema: '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
  outputSchema: '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
  dataScope: [] as string[],
  readsRawTranscript: false,
  fallbackDeclaration: "模型不可用时返回空结论并提示人工整理",
};

const draftBody = (name: string) => ({
  orgId: ORG,
  name,
  duty: "访谈纪要 → 结论",
  contract: CONTRACT,
  visibility: "org-wide" as const,
  modelRef: "model-default",
});

const createAs = async (user: string, name: string) => {
  const response = await fetch(`${BASE}${C.operations.createSkillDraft.path}`, {
    method: "POST",
    headers: principal(user),
    body: JSON.stringify(draftBody(name)),
  });
  return { status: response.status, raw: (await response.json()) as Record<string, unknown> };
};

const disablePath = (skillId: string) =>
  C.operations.disableSkill.path.replace(":skillId", skillId);

const disableAs = async (user: string, skillId: string) => {
  const response = await fetch(`${BASE}${disablePath(skillId)}`, {
    method: "POST",
    headers: principal(user),
    body: JSON.stringify({
      skillId,
      referenceSnapshotId: "ref-snapshot-i532",
      mode: "drain",
      archive: false,
      replacementSkillId: null,
    }),
  });
  return { status: response.status, raw: (await response.json()) as Record<string, unknown> };
};

/** 库里当前 org 下叫这个名字的行数——「被拒了但还是写进去了」在这里会红。 */
const rowsNamed = async (name: string) =>
  (
    await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM skill_contracts WHERE org_id = $1 AND name = $2", [ORG, name]),
    )
  ).rowCount;

/**
 * 把某人移出组织——**限定到本文件自有的 org**。
 *
 * 走 `org_memberships` 的删行，因为 `findOrgMembership`
 * （`src/infrastructure/identity/pg-identity-repository.ts:49`）就是 SELECT 这张表，
 * 删行正是「被移出组织」在库里的形状。会话（测试 principal 头）照旧还在手上。
 */
const removeOrgMember = (userId: string) =>
  asApp(ORG, (c) =>
    c.query("DELETE FROM org_memberships WHERE org_id = $1 AND user_id = $2", [ORG, userId]),
  );

/** 先证 fixture 真的生效——「移除没成功」会让下面的断言变成空转。 */
async function removeAndAssertGone(userId: string): Promise<void> {
  await removeOrgMember(userId);
  const still = await asApp(ORG, (c) =>
    c.query("SELECT 1 FROM org_memberships WHERE org_id = $1 AND user_id = $2", [ORG, userId]),
  );
  expect(still.rowCount).toBe(0);
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i532" });
  await addOrgMember(ORG, INSIDER, "admin", null);
  // EX_MEMBER 一开始**是**成员——「被移出」得先有得移，否则测的是「从没进来过」。
  // `consultant` 是 `OrgRole` 四个合法值之一（`packages/contracts/src/identity.ts:200`，
  // 库侧 CHECK 同源）——写一个不在枚举里的角色会在 fixture 阶段就炸，
  // 那样红的不是被测的那一步。
  await addOrgMember(ORG, EX_MEMBER, "consultant", null);
});

describe("#532 POST /skills 判成员资格（存在性，不是接线）", () => {
  it("已被移出组织但仍持有会话者，建不出草稿 —— 403 PERMISSION_REVOKED", async () => {
    await removeAndAssertGone(EX_MEMBER);
    const NAME = "越权草稿-i532";

    const { status, raw } = await createAs(EX_MEMBER, NAME);

    // ⚠ 逐字 403 + PERMISSION_REVOKED：一条只查 `status >= 400` 的断言分不出
    //   「授权拒了」与「校验/重名拒了」。
    expect(status, JSON.stringify(raw)).toBe(403);
    expect(raw.reasonCode).toBe("PERMISSION_REVOKED");
    // 缺授权层时这里拿到的是 201 + skillId —— 响应体里逐字带着不该出现的东西。
    expect(raw.skillId).toBeUndefined();

    // 「不入库」是行为，不是文案：一个「写进去了但返回 403」的实现在这里红。
    expect(await rowsNamed(NAME)).toBe(0);
  });

  it("配对断言：同一条路径、同一份请求体，在册成员建得出（否则上一条可能是空转）", async () => {
    await removeAndAssertGone(EX_MEMBER);
    const NAME = "正当草稿-i532";

    const { status, raw } = await createAs(INSIDER, NAME);

    // 「路由整体挂了」「守卫写成恒拒」在这里会红。
    expect(status, JSON.stringify(raw)).toBe(201);
    expect(typeof raw.skillId).toBe("string");
    expect(raw.status).toBe("草稿");
    expect(await rowsNamed(NAME)).toBe(1);
  });
});

describe("#532 POST /skills/:skillId/disable 判成员资格（拒绝必须来自授权，不是状态机）", () => {
  it("已被移出组织但仍持有会话者，停用被**授权层**拒 —— 不是被 R7 兜住", async () => {
    const created = await createAs(INSIDER, "待停用-i532");
    expect(created.status, JSON.stringify(created.raw)).toBe(201);
    const skillId = created.raw.skillId as string;

    await removeAndAssertGone(EX_MEMBER);

    const { status, raw } = await disableAs(EX_MEMBER, skillId);

    // ★ 本文件的核心断言。今天（无授权层）这里是 422 `REFERENCES_NOT_ENUMERATED`：
    //   请求确实走到了用例，是**状态机/引用清单**把它挡住的。那不是授权。
    expect(status, JSON.stringify(raw)).toBe(403);
    expect(raw.reasonCode).toBe("PERMISSION_REVOKED");
    // 显式排除「兜底那两个码」——它们出现就说明授权层还是不存在。
    expect(raw.reasonCode).not.toBe("REFERENCES_NOT_ENUMERATED");
    expect(raw.reasonCode).not.toBe("SKILL_VERSION_CHANGED");
  });

  it("配对断言：在册成员走同一条路径，**不**被授权层挡（挡它的是 R7 第一道门）", async () => {
    const created = await createAs(INSIDER, "待停用配对-i532");
    expect(created.status, JSON.stringify(created.raw)).toBe(201);
    const skillId = created.raw.skillId as string;

    await removeAndAssertGone(EX_MEMBER);

    const { status, raw } = await disableAs(INSIDER, skillId);

    // 新加的授权层若写成恒拒 / 把 `admin` 也拦下，这里会变成 403 而红。
    expect(status, JSON.stringify(raw)).not.toBe(403);
    // R7「无清单不得停用」：`listReferences` 没有生产者 ⇒ 没有新鲜快照。
    // 这条同时钉住「授权排在状态机之前，且没有把合法路径一起堵死」。
    expect(status, JSON.stringify(raw)).toBe(422);
    expect(raw.reasonCode).toBe("REFERENCES_NOT_ENUMERATED");
  });
});
