/**
 * #459 —— 声明式契约 skill 的最小切片，**打真实 PostgreSQL**。
 *
 * ⚠ **F192（design-delta `skill-model-a-b-convergence` 选项②，issue #598，
 * 2026-08-16 已签核）之后**：`POST /skills`（`createSkillDraft`）已冻结为恒 410
 * ——本文件原本靠它建草稿再测列表/详情/停用，现在种子改走 `seedSkillDraft`
 * （应用层直调，绕过已冻结的 HTTP 写路由，见 `tests/support/skill-draft-fixture.ts`）。
 * 原来断言「建草稿会 201」的用例改为断言新语义：**新写入路径已关闭，存量数据仍可读**。
 *
 * 断言五件事：
 *   ① 写入口已关闭：`POST /skills` 对任何请求恒 410，不入库（专用反证见
 *      `tests/skill/post-skills-gone-410.test.ts`，这里只保留与本文件既有种子
 *      写法一一对应的那几条，不重复整套矩阵）
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
import { seedSkillDraft } from "../support/skill-draft-fixture";
import { OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";

/**
 * design-delta `platform-owned-skills`（2026-08-27）—— 四个官方 skill 现在对**每一个**
 * org 都可见（RLS platform-read 策略 + 查询层 OR 子句），包括这份测试用的 `ORG`。这不是
 * 测试隔离缺陷：这份夹具从未自己种过它们，只有当同一次 `with-test-isolation` 共享的
 * 数据库里**另一个测试文件**（如 `platform-owned-skills-real-stack.test.ts`）先跑过
 * `backfillPlatformSkills()`，它们才会出现——`org-platform` 是全局共享事实（同生产），
 * `resetOrgs(ORG, OTHER_ORG)` 不会、也不应该清掉它。下面两条断言原本假设"这个 org 的
 * 列表 = 只有它自己种的草稿"，现在要**排除掉平台官方 skill 再数**，不然断言在"平台
 * skill 是否已被种进这次共享测试库"这件与本文件无关的事实上随机摇摆。
 */
const isOfficialPlatformSkill = (skillId: string): boolean =>
  OFFICIAL_SKILLS.some((s) => s.skillId === skillId);

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
 *   `DATA_SCOPE_EXCEEDS_SUBMITTER`——**F192 之前**如此；F192 之后，写入口
 *   本身已冻结，这条校验永远到达不了（见下方「越权数据范围声明」那条用例的新断言）。
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

/** 种一份草稿——绕过已冻结的 `POST /skills`（F192），走应用层同一套校验/落库逻辑。 */
const seedDraft = (name: string) =>
  seedSkillDraft(app, { orgId: ORG, submitterId: ACTOR, name, contract: CONTRACT, visibility: "org-wide" });

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

describe("F192 · POST /skills 新写入路径已关闭，存量数据仍可读", () => {
  it("建草稿曾经落 `草稿` 态、201——现在恒 410，且不入库（新写入路径已关闭）", async () => {
    const response = await post(C.operations.createSkillDraft.path, createBody("纪要压缩器"));
    expect(response.status).toBe(410);
    const raw = (await response.json()) as { reasonCode?: string };
    expect(raw.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");

    // 库里没有多出一行——「拒绝了但还是写了」在这里会红。
    const rows = await asApp(ORG, (c) =>
      c.query("SELECT id FROM skill_contracts WHERE org_id = $1", [ORG]),
    );
    expect(rows.rows).toEqual([]);
  });

  it("试图写 source（曾经 ⇒ SOURCE_TAG_IMMUTABLE）——现在写入口本身已冻结，同样是 410 且不入库", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      createBody("试图自定来源", { source: "CC" }),
    );
    // ⚠ 新语义：不再是「校验层挡住了越权字段」（400/403/422 那三种），是写入口本身
    //   已经无条件关闭——`source` 字段合不合法根本没有机会被检查。
    expect(response.status).toBe(410);
    const listed = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    const body = (await listed.json()) as { items: readonly { skillId: string }[] };
    // design-delta `platform-owned-skills`：过滤掉四个官方 skill 再断言"没多写一行
    // org 自己的 skill"——见文件顶部 `isOfficialPlatformSkill` 的注释。
    expect(body.items.filter((i) => !isOfficialPlatformSkill(i.skillId))).toEqual([]);
  });

  it("越权数据范围声明（曾经 ⇒ DATA_SCOPE_EXCEEDS_SUBMITTER）——现在写入口本身已冻结，同样是 410 且不入库", async () => {
    const response = await post(
      C.operations.createSkillDraft.path,
      createBody("越权的 skill", {
        contract: { ...CONTRACT, dataScope: ["crm:customer:read"] },
      }),
    );
    // ⚠ 新语义：不再是「数据范围越权检查」拒绝（那条校验逻辑仍在
    //   `application/skill/create-skill-draft.ts` 里，未删除，只是没有 HTTP 路由
    //   能到达它）——是写入口本身已经无条件关闭。
    expect(response.status).toBe(410);
    const raw = (await response.json()) as { reasonCode?: string };
    expect(raw.reasonCode).toBe("SKILL_DRAFT_WRITE_PATH_FROZEN");

    // E1 的性质依然成立，只是理由变了：失败**不入库**。
    const rows = await asApp(ORG, (c) =>
      c.query("SELECT id FROM skill_contracts WHERE org_id = $1", [ORG]),
    );
    expect(rows.rows).toEqual([]);
  });
});

describe("F192 · 存量数据（经应用层直调种下的草稿）仍可读", () => {
  it("列表能看见种下的草稿，出参过契约 strict 校验", async () => {
    const created = await seedDraft("纪要压缩器");

    const response = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    expect(response.status).toBe(200);
    const raw = (await response.json()) as unknown;
    const parsed = C.operations.listSkills.out.safeParse(raw);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(raw)).toBeNull();
    const listed = parsed.success ? parsed.data : null!;

    // 平台官方 skill（design-delta `platform-owned-skills`）不算这个 org 自己种的
    // 东西——过滤掉再断言，见文件顶部 `isOfficialPlatformSkill` 的注释。
    expect(listed.total).toBe(listed.items.length); // total 与实际返回条数自洽
    const ownItems = listed.items.filter((i) => !isOfficialPlatformSkill(i.skillId));
    expect(ownItems).toHaveLength(1);
    expect(ownItems[0]?.skillId).toBe(created.skillId);
    expect(ownItems[0]?.name).toBe("纪要压缩器");
    expect(ownItems[0]?.status).toBe("草稿");
    // 草稿没有生效版本——不得为了填满界面把草稿版本号塞进这个字段。
    expect(ownItems[0]?.currentVersionId).toBeNull();
    // null ⟺ 样本不足。契约逐字：**不得给一个 0%**。
    expect(ownItems[0]?.satisfaction).toBeNull();
  });

  it("空组织没有自己的 org-owned skill（真实空态），**不生成示例 skill**", async () => {
    // ⚠ design-delta `platform-owned-skills` 之后，"空" 不再等于 `items` 恒为 `[]`——
    // 四个官方 skill 对所有 org 可见是这个 delta 的**本意**，不是要在这里被断言掉的
    // 缺陷。这条测试原本要守的是"没有为了填满界面伪造一个这个 org 自己的 skill"，
    // 该守的性质换成"过滤掉平台官方 skill 之后为空"依然成立，逐字照旧。
    const response = await get(`${C.operations.listSkills.path}?orgId=${ORG}&entry=library`);
    const body = (await response.json()) as { items: readonly { skillId: string }[]; total: number };
    const ownItems = body.items.filter((i) => !isOfficialPlatformSkill(i.skillId));
    expect(ownItems).toEqual([]);
    expect(body.total).toBe(body.items.length); // total 与实际返回条数自洽
  });

  it("详情可读，出参过契约 strict 校验，且门禁结果如实是「都没过」", async () => {
    const created = await seedDraft("纪要压缩器");

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
    const created = await seedDraft("纪要压缩器");

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
    const created = await seedDraft("纪要压缩器");

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
    const created = await seedDraft("纪要压缩器");

    // 契约 :336 逐字：「一条直达的启用路由**就是那条绕过路径本身**」。
    // 交付物是一条断言它不存在的测试，不是一个接口。
    const response = await post(`/skills/${created.skillId}/enable`, {});
    expect(response.status).toBe(404);
    expect(await statusInDb(created.skillId)).toBe("草稿");
  });
});
