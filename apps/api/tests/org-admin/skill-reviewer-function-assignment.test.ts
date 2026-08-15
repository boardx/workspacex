/**
 * issue #852 —— 组织管理员任命「Skill 审核人职能」，打真实 PostgreSQL + 真实 HTTP。
 *
 * 在这份测试之前，全仓对 `skill_reviewer_functions` 的每一次写入都来自种子脚本或
 * 测试夹具的裸 `INSERT`（`skill-review-gate.test.ts` 的 `beforeEach` 就是一例，文件里
 * 逐字写着「指派动作属 identity 域、本束不建那个操作 ⇒ 测试里只能种这个前置条件」）。
 * 这份测试要证明的是：**这条路现在从产品入口就能走通**，不需要种子。
 *
 * 反证重点（同 skill-review-gate.test.ts 的既定纪律，断行为不只断状态码）：
 *   ① 一个新组织从零开始，`functionOf()` 恒 null（不预置任何指派）；
 *   ② 组织管理员通过真实 API 任命一名成员为 `methodology-reviewer`；
 *   ③ **该成员真的能**把一个 skill 从草稿批到「已启用」——库里那一行真的变了，
 *      不是接口返回 200 就算数；
 *   ④ 非管理员调用任命接口 ⇒ 403，且库里没有产生任何指派行；
 *   ⑤ 撤销后该成员批不动（职能变回 null）；
 *   ⑥ 对同一人重复指派是覆盖（upsert），不是叠加出两行。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { orgAdmin as OA, skills as C } from "@repo/contracts";
import { addCredential, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i852-reviewer-assign";
const ADMIN = "u-i852-admin";
const MEMBER = "u-i852-member";
const OUTSIDER = "u-i852-outsider";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string) => ({
  "x-kernel-test-principal": `${user}:${ORG}`,
  "content-type": "application/json",
});

const post = (path: string, body: unknown, user: string) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: principal(user), body: JSON.stringify(body) });
const get = (path: string, user: string) => fetch(`${BASE}${path}`, { headers: principal(user) });

const assignPath = (userId: string) =>
  OA.operations.assignSkillReviewerFunction.path.replace(":orgId", ORG).replace(":userId", userId);
const revokePath = (userId: string) =>
  OA.operations.revokeSkillReviewerFunction.path.replace(":orgId", ORG).replace(":userId", userId);
const listPath = OA.operations.listSkillReviewerFunctions.path.replace(":orgId", ORG);

/** `.strict()` 的 `in` 里带 `orgId`/`userId`（同 `removeOrgMember` 先例），body 必须逐字带上。 */
const assignBody = (userId: string, reviewerFunction: "methodology-reviewer" | "security-reviewer") => ({
  orgId: ORG,
  userId,
  reviewerFunction,
});
const revokeBody = (userId: string) => ({ orgId: ORG, userId });

const functionOfInDb = (userId: string) =>
  asApp(ORG, async (c) => {
    const r = await c.query<{ reviewer_function: string }>(
      "SELECT reviewer_function FROM skill_reviewer_functions WHERE org_id = $1 AND principal_id = $2",
      [ORG, userId],
    );
    return r.rows[0]?.reviewer_function ?? null;
  });

const CONTRACT = {
  promptTemplate: "把访谈纪要压成三条结论",
  inputSchema: '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
  outputSchema: '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
  dataScope: [] as string[],
  readsRawTranscript: false,
  fallbackDeclaration: "模型不可用时返回空结论并提示人工整理",
};

const createBody = (name: string) => ({
  orgId: ORG,
  name,
  duty: "访谈纪要 → 结论",
  contract: CONTRACT,
  visibility: "org-wide",
  modelRef: "model-default",
});

const versionPath = (path: string, versionId: string) => path.replace(":versionId", versionId);

async function createDraft(name: string, user: string): Promise<{ skillId: string; versionId: string }> {
  const response = await post(C.operations.createSkillDraft.path, createBody(name), user);
  expect(response.status).toBe(201);
  return (await response.json()) as { skillId: string; versionId: string };
}

const scan = (versionId: string, user: string) =>
  post(versionPath(C.operations.runSecurityScan.path, versionId), { versionId }, user);
const submit = (versionId: string, user: string) =>
  post(versionPath(C.operations.submitSkillForReview.path, versionId), { versionId, expectedVersion: "草稿" }, user);
const review = (versionId: string, decision: "approve" | "reject", user: string) =>
  post(
    versionPath(C.operations.reviewSkillVersion.path, versionId),
    { versionId, decision, reason: "契约正文与数据范围声明已复核", riskAcks: [] },
    user,
  );

const statusInDb = (skillId: string) =>
  asApp(ORG, async (c) => {
    const r = await c.query<{ status: string }>(
      "SELECT status FROM skill_contracts WHERE org_id = $1 AND id = $2",
      [ORG, skillId],
    );
    return r.rows[0]?.status ?? null;
  });

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
  await seedOrg({ orgId: ORG, projectId: "proj-i852" });
  await addCredential(ADMIN, "admin@i852.test", "管理员");
  await addCredential(MEMBER, "member@i852.test", "普通成员");
  await addCredential(OUTSIDER, "outsider@i852.test", "非本组织");
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
});

describe("issue #852：组织管理员任命 Skill 审核人职能，打真实 Postgres", () => {
  it("① 新组织从零开始，functionOf() 恒 null（不预置任何指派）", async () => {
    expect(await functionOfInDb(MEMBER)).toBeNull();
  });

  it("② 管理员通过真实 API 任命 MEMBER 为 methodology-reviewer，库里真的落了一行", async () => {
    const res = await post(assignPath(MEMBER), assignBody(MEMBER, "methodology-reviewer"), ADMIN);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { userId: string; reviewerFunction: string; assignedBy: string };
    expect(body).toMatchObject({ userId: MEMBER, reviewerFunction: "methodology-reviewer", assignedBy: ADMIN });
    expect(await functionOfInDb(MEMBER)).toBe("methodology-reviewer");
  });

  it("③ 端到端：任命之后，该成员真的能把一个新 skill 批到「已启用」——不是种子，是产品路径", async () => {
    // 提交人另开一个账号，避免撞到「提交人≠审核人」判定，验的是任命链路本身。
    const submitter = "u-i852-submitter";
    await addCredential(submitter, "submitter@i852.test", "提交人");
    await addOrgMember(ORG, submitter, "consultant", null);

    const assignRes = await post(assignPath(MEMBER), assignBody(MEMBER, "methodology-reviewer"), ADMIN);
    expect(assignRes.status).toBe(201);

    const draft = await createDraft("i852-skill", submitter);
    expect((await scan(draft.versionId, submitter)).status).toBe(201);
    expect((await submit(draft.versionId, submitter)).status).toBe(201);

    const reviewRes = await review(draft.versionId, "approve", MEMBER);
    expect(reviewRes.status).toBe(201);
    const reviewBody = (await reviewRes.json()) as { skillStatus: string };
    expect(reviewBody.skillStatus).toBe("已启用");
    expect(await statusInDb(draft.skillId)).toBe("已启用");
  });

  it("④ 非管理员调用任命接口 ⇒ 403，且不产生任何指派行", async () => {
    const res = await post(assignPath(OUTSIDER), assignBody(OUTSIDER, "methodology-reviewer"), MEMBER);
    expect(res.status).toBe(403);
    expect(await functionOfInDb(OUTSIDER)).toBeNull();
  });

  it("⑤ 目标不是本组织成员 ⇒ MEMBER_NOT_FOUND（404）", async () => {
    const res = await post(assignPath("u-does-not-exist"), assignBody("u-does-not-exist", "methodology-reviewer"), ADMIN);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("MEMBER_NOT_FOUND");
  });

  it("⑥ 撤销后该成员批不动——REVIEWER_FUNCTION_MISMATCH 之外的另一形态：职能已变回 null", async () => {
    const submitter = "u-i852-submitter2";
    await addCredential(submitter, "submitter2@i852.test", "提交人二");
    await addOrgMember(ORG, submitter, "consultant", null);

    await post(assignPath(MEMBER), assignBody(MEMBER, "methodology-reviewer"), ADMIN);
    const draft = await createDraft("i852-skill-2", submitter);
    await scan(draft.versionId, submitter);
    await submit(draft.versionId, submitter);

    const revokeRes = await post(revokePath(MEMBER), revokeBody(MEMBER), ADMIN);
    expect(revokeRes.status).toBe(201);
    expect(await functionOfInDb(MEMBER)).toBeNull();

    const reviewRes = await review(draft.versionId, "approve", MEMBER);
    expect(reviewRes.status).toBe(403);
    const body = (await reviewRes.json()) as { reasonCode: string };
    // 无职能 ⇒ `REVIEWER_FUNCTION_MISMATCH`（review-authorization.ts：非
    // methodology-reviewer 一律折进同一个拒绝码，null 与 security-reviewer 走同一分支）。
    expect(body.reasonCode).toBe("REVIEWER_FUNCTION_MISMATCH");
    expect(await statusInDb(draft.skillId)).not.toBe("已启用");
  });

  it("⑦ 撤销一个从未被指派过的人 ⇒ NOT_ASSIGNED（404）", async () => {
    const res = await post(revokePath(MEMBER), revokeBody(MEMBER), ADMIN);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { reasonCode: string };
    expect(body.reasonCode).toBe("NOT_ASSIGNED");
  });

  it("⑧ 重复指派是覆盖（upsert），不是叠加出两行；listSkillReviewerFunctions 只见到一条", async () => {
    await post(assignPath(MEMBER), assignBody(MEMBER, "methodology-reviewer"), ADMIN);
    await post(assignPath(MEMBER), assignBody(MEMBER, "security-reviewer"), ADMIN);

    expect(await functionOfInDb(MEMBER)).toBe("security-reviewer");

    const listRes = await get(listPath, ADMIN);
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as { assignments: { userId: string; reviewerFunction: string }[] };
    const mine = body.assignments.filter((a) => a.userId === MEMBER);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.reviewerFunction).toBe("security-reviewer");
  });

  it("⑨ listSkillReviewerFunctions 非管理员调用 ⇒ 403", async () => {
    const res = await get(listPath, MEMBER);
    expect(res.status).toBe(403);
  });
});
