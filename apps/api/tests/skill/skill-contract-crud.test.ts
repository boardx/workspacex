/**
 * #459 —— 声明式契约 skill 的最小切片，**打真实 PostgreSQL**。
 *
 * 断言四件事：
 *   ① 建草稿 → 库里真有行（不是「接口返回 200」）
 *   ② 列表可见，且**出参过契约 `out` 的 strict 校验**
 *      （zod 默认剥未知键——#19 记过这个坑，不 strict 等于没校验）
 *   ③ 详情可读
 *   ④ **停用被拒，且库内状态未变** —— 这是本 issue 真正要证的性质
 *
 * ⚠ 本文件**不测**「发布 v1 → 停用成功」：`已启用` 只能由 `reviewSkillVersion`
 *   的 approve 分支产生（`domain/skill/security-gate.ts:144`），而那条用例连同
 *   `submitSkillForReview` / `listReferences` / 第二评审人都被 coord-main 移出 #459。
 *   契约 `SKILLS_FORBIDDEN_ROUTES` 还逐字禁止一条直达的启用路由，所以这里**没有**
 *   任何捷径可走——写一条捷径正是那条纪律要防的东西。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { skills as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i459-skill";
const OTHER_ORG = "org-i459-skill-other";
const ACTOR = "u-i459-actor";
const STRANGER = "u-i459-stranger";

let app: NestExpressApplication;
let BASE = "";

const principal = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

/**
 * 一份**不申请任何数据范围**的契约正文。
 *
 * ⚠ `dataScope: []` / `readsRawTranscript: false` 不是图省事：`SubmitterGrantsPort`
 *   今天恒返回空集（`FailClosedSubmitterGrants`，因为「某人持有哪些数据范围」
 *   在全仓没有事实源），所以任何非空声明都会被正确地判成
 *   `DATA_SCOPE_EXCEEDS_SUBMITTER`。下面 `拒绝越权声明` 那条用例就断言这件事。
 */
const CONTRACT = {
  promptTemplate: "把访谈纪要压成三条结论",
  inputSchema: '{"type":"object","properties":{"notes":{"type":"string"}},"required":["notes"]}',
  outputSchema: '{"type":"object","properties":{"points":{"type":"array"}},"required":["points"]}',
  dataScope: [] as string[],
  readsRawTranscript: false,
  fallbackDeclaration: "模型不可用时返回空结论并提示人工整理",
};

const createBody = (name: string, overrides: Record<string, unknown> = {}) => ({
  orgId: ORG,
  name,
  duty: "访谈纪要 → 结论",
  contract: CONTRACT,
  visibility: "org-wide",
  modelRef: "model-default",
  ...overrides,
});

const post = (path: string, body: unknown, user = ACTOR, org = ORG) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: principal(user, org), body: JSON.stringify(body) });

const get = (path: string, user = ACTOR, org = ORG) =>
  fetch(`${BASE}${path}`, { headers: principal(user, org) });

/** 直接读库——「接口说建好了」和「库里真有一行」是两件事。 */
const statusInDb = (skillId: string, org = ORG) =>
  asApp(org, async (c) => {
    const r = await c.query<{ status: string }>(
      "SELECT status FROM skill_contracts WHERE org_id = $1 AND id = $2",
      [org, skillId],
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
  await resetOrgs(ORG, OTHER_ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i459" });
  await seedOrg({ orgId: OTHER_ORG, projectId: "proj-i459-other" });
  await addOrgMember(ORG, ACTOR, "admin", null);
  await addOrgMember(OTHER_ORG, STRANGER, "admin", null);
});

describe("#459 建草稿 → 列表 → 详情", () => {
  it("建草稿落 `草稿` 态，库里真有行，出参过契约 strict 校验", async () => {
    const response = await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"));
    expect(response.status).toBe(201);

    const raw = (await response.json()) as unknown;
    const parsed = C.operations.createSkillDraft.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const created = parsed.success ? parsed.data : null!;

    expect(created.status).toBe("草稿");
    // `source` 由系统按入口打标（I-11），调用方没传过这个字段。
    expect(created.source).toBe("自建");
    // 库里真的有，且状态就是接口说的那个。
    expect(await statusInDb(created.skillId)).toBe("草稿");
  });

  it("`source` 由系统打标：调用方写它 ⇒ SOURCE_TAG_IMMUTABLE，且不入库", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      createBody("试图自定来源", { source: "CC" }),
    );
    // `createSkillDraft.in` 是 `.strict()` 的，多一个键先被 ZodBodyPipe 判 400；
    // 无论走哪一道，**都不入库**才是要断言的行为。
    expect([400, 403, 422]).toContain(response.status);
    const listed = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    const body = (await listed.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("越权数据范围声明被拒，且**不入库、不进待审核队列**", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      createBody("越权的 skill", {
        contract: { ...CONTRACT, dataScope: ["crm:customer:read"] },
      }),
    );
    // 403 而非 422：越权不是「正文写错了」，是**提交人没有这项权限**（I-12 的上界）。
    // 状态码与 reasonCode 两条都断——只断状态码的话，一个把所有失败都折成 403
    // 的实现照样绿，而界面正是靠 reasonCode 决定要不要给「申请授权」入口。
    expect(response.status).toBe(403);
    expect(((await response.json()) as { reasonCode: string }).reasonCode).toBe(
      "DATA_SCOPE_EXCEEDS_SUBMITTER",
    );

    // E1 逐字：失败**不入库**。断言的是「一行都没有」，不是返回码。
    const rows = await asApp(ORG, (c) =>
      c.query("SELECT id FROM skill_contracts WHERE org_id = $1", [ORG]),
    );
    expect(rows.rows).toEqual([]);
  });

  it("列表能看见刚建的草稿，出参过契约 strict 校验", async () => {
    const created = await (await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"))).json() as {
      skillId: string;
    };

    const response = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    expect(response.status).toBe(200);
    const raw = (await response.json()) as unknown;
    const parsed = C.operations.listSkills.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const listed = parsed.success ? parsed.data : null!;

    expect(listed.total).toBe(1);
    expect(listed.items[0]?.skillId).toBe(created.skillId);
    expect(listed.items[0]?.name).toBe("纪要压缩器");
    expect(listed.items[0]?.status).toBe("草稿");
    // 草稿没有生效版本——不得为了填满界面把草稿版本号塞进这个字段。
    expect(listed.items[0]?.currentVersionId).toBeNull();
    // null ⟺ 样本不足。契约逐字：**不得给一个 0%**。
    expect(listed.items[0]?.satisfaction).toBeNull();
  });

  it("空组织返回 `[]`（真实空态），**不生成示例 skill**", async () => {
    const response = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    const body = (await response.json()) as { items: unknown[]; total: number };
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("详情可读，出参过契约 strict 校验，且门禁结果如实是「都没过」", async () => {
    const created = (await (
      await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"))
    ).json()) as { skillId: string };

    const response = await get(`/skills/${created.skillId}`);
    expect(response.status).toBe(200);
    const raw = (await response.json()) as unknown;
    const parsed = C.operations.getSkillDetail.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const detail = parsed.success ? parsed.data : null!;

    expect(detail.skill.skillId).toBe(created.skillId);
    // 契约正文原样读得回来——「刚写的契约看不到」会是用户当场撞见的洞。
    expect(detail.contract.promptTemplate).toBe(CONTRACT.promptTemplate);
    expect(detail.latestTrialRun).toBeNull();
    expect(detail.gateResults.securityScan).toBeNull();
    expect(detail.gateResults.methodologyReviewPassed).toBe(false);
  });

  it("跨租户按 id 直取读不到，且是 404 而非 403（I-14：范围外不返回其存在性）", async () => {
    const created = (await (
      await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"))
    ).json()) as { skillId: string };

    const response = await get(`/skills/${created.skillId}`, STRANGER, OTHER_ORG);
    expect(response.status).toBe(404);
  });
});

describe("#459 停用被正确拒绝，且库内状态未变", () => {
  /**
   * ⚠ 期望的错误码是 `REFERENCES_NOT_ENUMERATED`，**不是** `GATE_NOT_PASSED`。
   *
   * 这是实测出来的、与 issue 文案不同的事实，写下来免得下一个人以为是笔误：
   * `disableSkill` 的第一道门是 R7「无清单不得停用」（`disable-skill.ts:41-44`），
   * 它在状态机之前。`GATE_NOT_PASSED` 只由 `authorizeStatusTransition` 在
   * **`to === "已启用"`** 时产生（`security-gate.ts:144`），而停用的 `to` 是
   * `已停用`，那条分支根本走不到。
   *
   * 要断言的**性质**是「门禁成立」：拒绝 ∧ 库内状态未变。两条都断，
   * 只断错误码的话，一个「返回错误码但已经把状态写进去了」的实现照样绿。
   */
  it("没有引用清单 ⇒ REFERENCES_NOT_ENUMERATED，且库里仍是 `草稿`", async () => {
    const created = (await (
      await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"))
    ).json()) as { skillId: string };

    const response = await post(`/skills/${created.skillId}/disable`, {
      skillId: created.skillId,
      referenceSnapshotId: "snapshot-that-was-never-taken",
      mode: "drain",
      archive: false,
      replacementSkillId: null,
    });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasonCode: string }).reasonCode).toBe(
      "REFERENCES_NOT_ENUMERATED",
    );
    // ★ 这一行才是本条用例的重点：拒绝之后库里**没有**被改。
    expect(await statusInDb(created.skillId)).toBe("草稿");
  });

  it("契约禁止的启用路由不存在（SKILLS_FORBIDDEN_ROUTES）", async () => {
    const created = (await (
      await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"))
    ).json()) as { skillId: string };

    // 契约 :336 逐字：「一条直达的启用路由**就是那条绕过路径本身**」。
    // 交付物是一条断言它不存在的测试，不是一个接口。
    const response = await post(`/skills/${created.skillId}/enable`, {});
    expect(response.status).toBe(404);
    expect(await statusInDb(created.skillId)).toBe("草稿");
  });
});
