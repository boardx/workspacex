/**
 * #527 —— `getSkillDetail` 的**成员资格**门禁有没有真的接上，打真实 PostgreSQL。
 *
 * ## 为什么在 #521 之外还要有这个文件
 *
 * PR #518（#459）修的越权是**成对出现的两处**，而 #521 / PR #524 只钉住了
 * `listSkills`（controller `:211`）。`getSkillDetail` 的接线逐字相同：
 *
 * ```
 * apps/api/src/interface/controllers/skill.controller.ts
 *   :211  orgRole: membership?.orgRole ?? null   ← listSkills，#521 已上钉子
 *   :247  orgRole: membership?.orgRole ?? null   ← getSkillDetail，本文件补的这颗
 * ```
 *
 * 判定链：`decideCapabilityVisibility`
 * （`src/domain/identity/capability-listing.ts:89-97`，把 `orgRole` 放进 `org.role`）
 * → `decide()`（`src/domain/identity/permission-decision.ts:63,117`：
 * `orgPassed = org.role !== null`，不过 ⇒ `deny("NO_ORG_MEMBERSHIP")`）
 * → `discloseDecided` / `isDisclosed` ⇒ controller `:253` 抛 404。
 *
 * 在本文件之前，**把 `:247` 回退成恒传成员角色，一条测试都不会红**。
 * 一个可以被静默回退的安全修复，等于没有修。
 *
 * ## 为什么断言 404 而不是 403
 *
 * controller `:241` 逐字写着「『不存在』与『存在但范围外』折成**同一个** 404
 * （I-14：范围外不返回其存在性）」。403 会把「这个 id 确实存在」告诉范围外的人，
 * 那本身就是一次泄漏。所以本文件断言的是 404 **且响应体里不含该 skill 的任何标识**。
 *
 * ## 断言打在 HTTP 响应体上，不是界面
 *
 * 要证的性质是「那条数据有没有过网」。「界面上看不到」是关于 React 的事实，
 * 与授权无关——数据一旦过网，devtools / 日志采样 / 任何第三方客户端都拿得到。
 * 同 `tests/chat/observer-downgrade-server-side.test.ts` 与 PR #524 的判据。
 *
 * ## 每条「拿不到」都配一条「拿得到」
 *
 * 否则一个「谁都拿不到」的实现——路由整体挂了、`isDisclosed` 恒 false、
 * fixture 根本没建出 skill——会让本文件全绿。配对断言用**同一条 skillId、
 * 同一个请求路径**，只换发起人。
 *
 * ## 反证（写完门控立刻造反证）
 *
 * 把 `:247` 回退成 `orgRole: "consultant"`（恒传成员角色），下面「已被移出组织者
 * 读不到详情」必须**当场变红**，且红在 `不含 skillId/name` 与 `404` 这两条**目标
 * 断言**上、响应体里**逐字带着**那条 skill 的 `skillId` 与 `name`，而配对的
 * 「在册成员读得到」**保持绿**。反证证据见 PR 正文。
 *
 * ⚠ 回退值必须用 `OrgRole` 的**合法值**（`packages/contracts/src/identity.ts:200`
 *   = `["admin","lead","consultant","compliance"]`，库侧 CHECK 同源）。PR #524
 *   第一次写成 `"member"`，fixture 阶段 `org_memberships_org_role_check` 就炸了，
 *   两条用例**都**红——红在被测的那一步**之前**，分不出好坏实现。
 *
 * ⚠ 本文件**不做**任何 `GRANT` / `REVOKE`：vitest 并行跑同一个 Postgres，
 *   对共享角色的无限定权限变更会把无关文件的 fixture 撞挂。移除成员资格
 *   用的是限定到本文件自有 org 的一条 `DELETE`。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

/** 本文件自有的 org id —— `resetOrgs` 是按 org 限定清理的，不得与别的文件重名。 */
const ORG = "org-i527-skill-detail-authz";
/** 一直在册的成员：既建数据，也充当配对断言的「读得到」那一侧。 */
const INSIDER = "u-i527-insider";
/** 曾是成员、被移出组织，但会话还在手上的人。 */
const EX_MEMBER = "u-i527-ex-member";

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

/**
 * 契约的 `getSkillDetail.path` 是 `/skills/:skillId`（`packages/contracts/src/skills.ts:505`）。
 * 从契约取模板再替换，而不是手写 `/skills/${id}`——路径改了本文件要一起红。
 */
const detailPath = (skillId: string) =>
  C.operations.getSkillDetail.path.replace(":skillId", encodeURIComponent(skillId));

const detailAs = async (user: string, skillId: string) => {
  const response = await fetch(`${BASE}${detailPath(skillId)}`, { headers: principal(user) });
  const raw = (await response.json()) as unknown;
  return { status: response.status, raw };
};

/** 建一条 `org-wide` 的草稿，返回它的 id。org-wide 是本 issue 要证的那个范围。 */
async function seedOrgWideSkill(): Promise<string> {
  const response = await fetch(`${BASE}${C.operations.createSkillDraft.path}`, {
    method: "POST",
    headers: principal(INSIDER),
    body: JSON.stringify({
      orgId: ORG,
      name: SKILL_NAME,
      duty: "访谈纪要 → 结论",
      contract: CONTRACT,
      visibility: "org-wide",
      modelRef: "model-default",
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { skillId: string }).skillId;
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
  await seedOrg({ orgId: ORG, projectId: "proj-i527" });
  await addOrgMember(ORG, INSIDER, "admin", null);
  // EX_MEMBER 一开始**是**成员——「被移出」得先有得移，否则测的是「从没进来过」。
  // `consultant` 是 `OrgRole` 四个合法值之一，见文件头那条 ⚠。
  await addOrgMember(ORG, EX_MEMBER, "consultant", null);
});

describe("#527 getSkillDetail 判成员资格（接线，不是 decide() 本身）", () => {
  it("已被移出组织但仍持有会话者，读不到该组织 org-wide skill 的详情", async () => {
    const skillId = await seedOrgWideSkill();

    // 移出组织。会话不动——这正是越权的入口条件。
    await removeOrgMember(EX_MEMBER);
    const stillMember = await asApp(ORG, (c) =>
      c.query("SELECT 1 FROM org_memberships WHERE org_id = $1 AND user_id = $2", [ORG, EX_MEMBER]),
    );
    // 先证 fixture 真的生效了——「移除没成功」会让下面那条断言变成空转。
    expect(stillMember.rowCount).toBe(0);

    const { status, raw } = await detailAs(EX_MEMBER, skillId);

    // ① 数据没有过网。放在 status 之前，是为了让回退接线时的失败输出**逐字**带上
    //    泄漏的 skillId / 契约正文——「红了」与「红得对」是两件事。
    const wire = JSON.stringify(raw);
    expect(wire).not.toContain(SKILL_NAME);
    expect(wire).not.toContain(skillId);
    expect(wire).not.toContain(CONTRACT.promptTemplate);

    // ② 404 而不是 403：「不存在」与「存在但范围外」折成同一个答案，
    //    否则 403 本身就泄漏了「这个 id 确实存在」（controller:241 / I-14）。
    expect(status).toBe(404);
    expect((raw as { reasonCode?: string }).reasonCode).toBe("SKILL_NOT_FOUND");
  });

  it("配对断言：同一条 skillId、同一条路径，在册成员读得到（否则上一条可能是空转）", async () => {
    const skillId = await seedOrgWideSkill();
    await removeOrgMember(EX_MEMBER);

    const { status, raw } = await detailAs(INSIDER, skillId);

    // 非 404，且出参过契约 strict 校验——「路由整体挂了」「isDisclosed 恒 false」
    // 「fixture 没建出 skill」这三种坏实现在这里会红。
    expect(status, JSON.stringify(raw)).toBe(200);
    const parsed = C.operations.getSkillDetail.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const detail = parsed.success ? parsed.data : null!;

    expect(detail.skill.skillId).toBe(skillId);
    expect(detail.skill.name).toBe(SKILL_NAME);
    expect(detail.skill.visibility).toBe("org-wide");
    // 上一条断言「契约正文没过网」，这一条断言它对在册成员**确实过网**——
    // 两条合起来才说明差别来自成员资格，而不是这个字段根本没被返回过。
    expect(detail.contract.promptTemplate).toBe(CONTRACT.promptTemplate);
  });
});
