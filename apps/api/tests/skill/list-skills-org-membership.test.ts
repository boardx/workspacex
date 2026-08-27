/**
 * #521 —— `listSkills` 的**成员资格**门禁有没有真的接上，打真实 PostgreSQL。
 *
 * ## 为什么单独有这个文件
 *
 * PR #518（#459）修了一个真实越权：`listSkills` 此前根本不判成员资格，
 * 一个**已被移出组织、但仍持有会话**的人可以列出该组织全部 `org-wide` skill。
 * 修法是把 `orgRole` 接到 `decide()` 的组织层
 * （`src/interface/controllers/skill.controller.ts:211`
 * → `src/application/skill/list-skills.ts:87-96`
 * → `src/domain/identity/permission-decision.ts:93,117` 的 `NO_ORG_MEMBERSHIP`）。
 *
 * 但**没有任何测试断言过 `orgRole: null ⇒ 空结果`**：
 * `tests/capability/skill/visibility-scope-four-entries.test.ts` 喂的是
 * `orgRole: "consultant"`，`decide()` 自己的用例又是纯函数级的。
 * ⇒ 把 controller:211 的 `membership?.orgRole ?? null` 回退成恒传成员角色，
 * 一条测试都不会红。**一个可以被静默回退的安全修复，等于没有修。**
 *
 * ## 断言打在 HTTP 响应体上，不是界面
 *
 * 要证的性质是「那条数据有没有过网」。「界面上看不到」是关于 React 的事实，
 * 与授权无关——数据一旦过网，devtools / 日志采样 / 任何第三方客户端都拿得到。
 * 同 `tests/chat/observer-downgrade-server-side.test.ts` 的判据。
 *
 * ## 每条「拿不到」都配一条「拿得到」
 *
 * 否则一个「谁都拿不到」的实现——接口整体挂了、过滤条件写成恒 false、
 * fixture 根本没建出 skill——会让本文件全绿。配对断言用**同一批数据、
 * 同一个请求路径**，只换发起人。
 *
 * ## 反证（写完门控立刻造反证）
 *
 * 把 controller:211 回退成 `orgRole: "member"`（恒传成员角色），
 * 下面「已被移出组织者列不到」必须**当场变红**，且红在 `items` 上
 * （即状态仍是 200、请求确实走到了用例，只是没被过滤），
 * 而配对的「在册成员列得到」保持绿。反证证据见 PR 正文。
 *
 * ⚠ 本文件**不做**任何 `GRANT` / `REVOKE`：vitest 并行跑同一个 Postgres，
 *   对共享角色的无限定权限变更会把无关文件的 fixture 撞挂。移除成员资格
 *   用的是限定到本文件自有 org 的一条 `DELETE`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { seedSkillDraft } from "../support/skill-draft-fixture";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

/** 本文件自有的 org id —— `resetOrgs` 是按 org 限定清理的，不得与别的文件重名。 */
const ORG = "org-i521-skill-authz";
/** 一直在册的成员：既建数据，也充当配对断言的「拿得到」那一侧。 */
const INSIDER = "u-i521-insider";
/** 曾是成员、被移出组织，但会话还在手上的人。 */
const EX_MEMBER = "u-i521-ex-member";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

/** 同 `skill-contract-crud.test.ts`：不申请任何数据范围，否则会被正确判成越权。 */
const CONTRACT = {
  promptTemplate: "把访谈纪要压成三条结论",
  inputSchema: '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
  outputSchema: '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
  dataScope: [] as string[],
  readsRawTranscript: false,
  fallbackDeclaration: "模型不可用时返回空结论并提示人工整理",
};

const SKILL_NAME = "纪要压缩器";

const listPath = `${C.operations.listSkills.path}?orgId=${ORG}&entry=library`;

const listAs = async (user: string) => {
  const response = await fetch(`${BASE}${listPath}`, { headers: principal(user) });
  const raw = (await response.json()) as unknown;
  return { status: response.status, raw };
};

/**
 * 建一条 `org-wide` 的草稿，返回它的 id。org-wide 是本 issue 要证的那个范围。
 *
 * ⚠ F192（design-delta `skill-model-a-b-convergence` 选项②）之后 `POST /skills`
 *   已冻结为 410——本文件要证的是 `listSkills` 的成员资格门禁，不是写入口本身，
 *   所以种子改走 `seedSkillDraft`（应用层直调，绕过已冻结的 HTTP 写路由）。
 */
async function seedOrgWideSkill(): Promise<string> {
  const { skillId } = await seedSkillDraft(app, {
    orgId: ORG,
    submitterId: INSIDER,
    name: SKILL_NAME,
    contract: CONTRACT,
    visibility: "org-wide",
  });
  return skillId;
}

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
  await seedOrg({ orgId: ORG, projectId: "proj-i521" });
  await addOrgMember(ORG, INSIDER, "admin", null);
  // EX_MEMBER 一开始**是**成员——「被移出」得先有得移，否则测的是「从没进来过」。
  // `consultant` 是 `OrgRole` 四个合法值之一（`packages/contracts/src/identity.ts:200`，
  // 库侧 CHECK 同源）——写一个不在枚举里的角色会在 fixture 阶段就炸，
  // 那样红的不是被测的那一步。
  await addOrgMember(ORG, EX_MEMBER, "consultant", null);
});

describe("#521 listSkills 判成员资格（接线，不是 decide() 本身）", () => {
  it("已被移出组织但仍持有会话者，列不到该组织的 org-wide skill", async () => {
    const skillId = await seedOrgWideSkill();

    // 移出组织。会话不动——这正是越权的入口条件。
    await removeOrgMember(EX_MEMBER);
    const stillMember = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM org_memberships WHERE org_id = $1 AND user_id = $2", [ORG, EX_MEMBER]),
    );
    // 先证 fixture 真的生效了——「移除没成功」会让下面那条断言变成空转。
    expect(stillMember.rowCount).toBe(0);

    const { status, raw } = await listAs(EX_MEMBER);

    // 200 而不是 4xx 是刻意断言的：它钉住「请求确实走到了 `listSkills`，
    // 是**过滤**把它清空的」。回退接线时红的因此是 `items`，而不是更早的一步。
    expect(status).toBe(200);
    const parsed = C.operations.listSkills.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const body = parsed.success ? parsed.data : null!;

    // 数据没有过网：不是「前端没渲染」，是响应体里根本没有。
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.items.map((i) => i.skillId)).not.toContain(skillId);
  });

  it("配对断言：同一批数据、同一条路径，在册成员列得到（否则上一条可能是空转）", async () => {
    const skillId = await seedOrgWideSkill();
    await removeOrgMember(EX_MEMBER);

    const { status, raw } = await listAs(INSIDER);

    expect(status).toBe(200);
    const parsed = C.operations.listSkills.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const body = parsed.success ? parsed.data : null!;

    // 非空，且就是上面那条 skill——「接口整体挂了」「过滤恒 false」在这里会红。
    // ⚠ design-delta `platform-owned-skills`：在册成员现在还会看到四个官方 skill，
    // 与本文件要守的"成员资格过滤"这件事无关（那四个走的是平台可见性，不受组织
    // 成员判定影响）——精确定位到刚种的那一条再断言，不再假设它是 items[0] 或
    // 唯一条目。
    const seeded = body.items.find((i) => i.skillId === skillId);
    expect(seeded, JSON.stringify(body.items)).toBeDefined();
    expect(seeded!.name).toBe(SKILL_NAME);
    expect(body.total).toBe(body.items.length);
  });
});
