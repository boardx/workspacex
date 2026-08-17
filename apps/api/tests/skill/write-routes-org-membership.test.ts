/**
 * #532 —— 写路由**成员资格**门禁存在性检查，打真实 PostgreSQL。
 *
 * ⚠ **F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598）之后**：
 * 本文件原来证的是两条写路由（`POST /skills`、`POST /skills/:skillId/disable`）
 * 各自的成员资格门禁。`create` 那一半的**前提已经不存在**——`POST /skills`
 * 现在对任何已认证请求都无条件 410（`skill.controller.ts` 的 `create` 方法），
 * 不再调用 `assertOrgMembership`，也不再区分「在册成员」与「被移出组织者」。
 * `create` 半边的原始反证（#532 实测：删掉 `org_memberships` 那行后 `POST /skills`
 * 返回 201 + 真实 skillId）已经是历史事实，不是今天的行为——见 F192 契约层
 * `@deprecated` 长注与 `tests/skill/post-skills-gone-410.test.ts` 的真栈反证。
 *
 * `disable` 那一半**完全不受影响**——它是唯一还在的写路由，成员资格门禁与
 * #532 修复时一致，本文件继续按原逻辑验证，只是种子改走 `seedSkillDraft`
 * （应用层直调，绕过已冻结的 `POST /skills`）。
 *
 * ## `disable` 断言打在「拒绝来自哪一层」，不只是「有没有被拒」
 *
 * 一条只断言 `response.status >= 400` 的测试，在**没有**授权层的今天就是绿的
 * （422 `REFERENCES_NOT_ENUMERATED` 也 >= 400）。所以这里逐字断言 `403` +
 * `PERMISSION_REVOKED`，并**显式排除** `REFERENCES_NOT_ENUMERATED` /
 * `SKILL_VERSION_CHANGED`——那两个码出现，就说明挡住它的还是状态机。
 *
 * 每条「不许写」都配一条「许写」：`disable` 在册成员 ⇒ **不是 403**，而是 422
 * `REFERENCES_NOT_ENUMERATED`（R7 第一道门）。这条同时钉住「授权层排在状态机
 * 之前、且没有把合法路径堵死」。
 *
 * ⚠ 本文件**不做**任何 `GRANT` / `REVOKE`：vitest 并行跑同一个 Postgres，对共享角色的
 *   无限定权限变更会把无关文件的 fixture 撞挂。移除成员资格用的是限定到本文件自有
 *   org 的一条 `DELETE`（同 `list-skills-org-membership.test.ts`）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { seedSkillDraft } from "../support/skill-draft-fixture";

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

/**
 * ⚠ F192 之后：仍然对着真实的、已冻结的 `POST /skills` 发请求（本文件保留这个
 *   函数名与调用方式，是刻意的——下面「create 恒 410」那组用例正是要证明
 *   「无论谁发、body 多合法，这条路由都不再区分身份」）。
 */
const createAs = async (user: string, name: string) => {
  const response = await fetch(`${BASE}${C.operations.createSkillDraft.path}`, {
    method: "POST",
    headers: principal(user),
    body: JSON.stringify(draftBody(name)),
  });
  return { status: response.status, raw: (await response.json()) as Record<string, unknown> };
};

/** 种一份草稿供 `disable` 半边用——绕过已冻结的 `POST /skills`（同 F192 其余测试文件）。 */
const seedDraftAs = (user: string, name: string) =>
  seedSkillDraft(app, { orgId: ORG, submitterId: user, name, contract: CONTRACT, visibility: "org-wide" });

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

describe("F192 · POST /skills 恒 410——成员资格不再是这条路由的准入判据", () => {
  it("已被移出组织但仍持有会话者：410（与 #532 时代的 403 不同——不是被授权层拒，是路由本身冻结了）", async () => {
    await removeAndAssertGone(EX_MEMBER);
    const NAME = "越权草稿-i532-已冻结";

    const { status, raw } = await createAs(EX_MEMBER, NAME);

    expect(status, JSON.stringify(raw)).toBe(410);
    expect(raw.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");
    expect(raw.skillId).toBeUndefined();
    expect(await rowsNamed(NAME)).toBe(0);
  });

  it("配对断言：同一条路径、同一份请求体，在册成员也一样是 410（不再有「许写」的那一侧）", async () => {
    await removeAndAssertGone(EX_MEMBER);
    const NAME = "正当草稿-i532-已冻结";

    const { status, raw } = await createAs(INSIDER, NAME);

    // ⚠ 这正是「唯一入口被摘」这个性质本身：F192 之前，在册成员在这里会拿到
    //   201；F192 之后，成员资格不再影响这条路由的结果——身份判定发生在
    //   路由**内部**被摘除之前就已经无条件拒绝了。
    expect(status, JSON.stringify(raw)).toBe(410);
    expect(raw.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");
    expect(await rowsNamed(NAME)).toBe(0);
  });
});

describe("#532 POST /skills/:skillId/disable 判成员资格（拒绝必须来自授权，不是状态机）——F192 后唯一还在的写路由", () => {
  it("已被移出组织但仍持有会话者，停用被**授权层**拒 —— 不是被 R7 兜住", async () => {
    const created = await seedDraftAs(INSIDER, "待停用-i532");
    const skillId = created.skillId;

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
    const created = await seedDraftAs(INSIDER, "待停用配对-i532");
    const skillId = created.skillId;

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
