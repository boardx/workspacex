/**
 * #1493（UC-7.3 第二块）—— `renderCanvas` + `exportSource` 端到端：
 * 真 HTTP → controller → application → repository → PostgreSQL
 * （同 `instance-source-chain-http.test.ts` 的纪律：持久面一律 asApp 重读，不信响应体）。
 *
 * I-8 的「收紧白名单」分支在 `render-export-projection.test.ts`（组织白名单持久层
 * 未落地，HTTP 链缺省 12 型全放行——update-canvas-source.ts 的同一句诚实声明）；
 * 本文件断言 HTTP 链上白名单**不碰源码**：render 前后 DB markdown 逐字节不变。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce,
  resetOrgs, seedAgendaSegment, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1493-re";
const OTHER_ORG = "org-1493-re-other";
const FACILITATOR = "u-1493re-fac";
const G1_MEMBER = "u-1493re-g1";
const G2_MEMBER = "u-1493re-g2";
const OUTSIDER = "u-1493re-outsider"; // org 成员但非项目成员
const SEGMENT = "seg-1493-re";

let BASE: string;
let app: NestExpressApplication;
let g1 = "";
let g2 = "";
let projectId = "";

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

/** 契约 SectionDef 全形状入库（renderCanvas 原样吐回它）。名字取引擎 swot 几何的同名分区。 */
const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

/** 手改后的源码：两个分区、三张便签（含颜色标记）+ 一个 mermaid 块。特意不含数字（I-9 反证）。 */
const MD = [
  "# SWOT 画布",
  "",
  "## 优势",
  "",
  "- 团队执行力强",
  "- 独家渠道 #blue",
  "",
  "## 劣势",
  "",
  "- 现金流紧张",
  "",
  "```mermaid",
  "flowchart TD",
  "  A-->B",
  "```",
  "",
].join("\n");

const render = (instanceId: string, userId: string, query = "", orgId = ORG) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/render${query}`, {
    headers: authFor(userId, orgId),
  });

const exportSource = (instanceId: string, body: unknown, userId: string) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/export-source`, {
    method: "POST", headers: authFor(userId), body: JSON.stringify(body),
  });

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

const readVersions = (instanceId: string) =>
  asApp(ORG, async (c) =>
    (await c.query<{ id: string; version: number; markdown: string }>(
      `SELECT id, version, markdown FROM canvas_instance_versions
        WHERE org_id = $1 AND instance_id = $2 ORDER BY version`,
      [ORG, instanceId],
    )).rows,
  );

/** 实例化 g1 一张画布并把源码推进到 MD（大多数用例的起点），返回 instanceId。 */
async function seedInstanceWithContent(): Promise<string> {
  const res = await fetch(`${BASE}/canvas/agenda-segments/${SEGMENT}/instances`, {
    method: "POST", headers: authFor(FACILITATOR),
    body: JSON.stringify({ agendaSegmentId: SEGMENT, groupIds: [g1], idempotencyKey: "idem-re" }),
  });
  expect(res.status).toBe(200);
  const out = C.operations.instantiateForSegment.out.parse(await res.json());
  const instanceId = out.instances[0]!.instanceId;
  const put = await fetch(`${BASE}/canvas/instances/${instanceId}/source`, {
    method: "PUT", headers: authFor(G1_MEMBER),
    body: JSON.stringify({ instanceId, markdown: MD, expectedHeadVersion: 1 }),
  });
  expect(put.status).toBe(200);
  return instanceId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG, OTHER_ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-workshop` });
  projectId = fixture.projectId;
  g1 = fixture.groups.g1!;
  g2 = fixture.groups.g2!;
  await addOrgMember(ORG, FACILITATOR, "admin", null);
  await addOrgMember(ORG, G1_MEMBER, "consultant", null);
  await addOrgMember(ORG, G2_MEMBER, "consultant", null);
  await addOrgMember(ORG, OUTSIDER, "consultant", null);
  await addProjectMember(ORG, projectId, FACILITATOR, "facilitator", null, true);
  await addProjectMember(ORG, projectId, G1_MEMBER, "member", g1);
  await addProjectMember(ORG, projectId, G2_MEMBER, "member", g2);
  await seedAgendaSegment(ORG, projectId, SEGMENT);
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          owner_team_id, underlying_type, sections)
       VALUES ($1,'swot',1,'SWOT 画布','published',NULL,false,'org-wide',NULL,'canvas',$2::jsonb)`,
      [ORG, JSON.stringify(SECTIONS)],
    );
    await c.query(
      `INSERT INTO canvas_template_bindings
         (id, org_id, agenda_segment_id, workshop_id, template_key, template_version)
       VALUES ('bind-1493-re',$1,$2,$3,'swot',1)`,
      [ORG, SEGMENT, projectId],
    );
  });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-workshop` });
  await addOrgMember(OTHER_ORG, "u-other", "consultant", null);
});

describe("#1493 · GET /canvas/instances/:id/render —— 渲染面", () => {
  it("200，响应逐字过契约 strict 校验：冻结分区全形状 + 文档序便签 + 渲染块；源码一个字节不动", async () => {
    const instanceId = await seedInstanceWithContent();
    const before = await readVersions(instanceId);

    const res = await render(instanceId, G1_MEMBER);
    expect(res.status).toBe(200);
    const out = C.operations.renderCanvas.out.parse(await res.json());

    // 分区 = 冻结模板版本的 SectionDef 原形（sectionId/required/capacity 全保留）。
    expect(out.sections).toEqual(SECTIONS);
    // 便签：文档序 id；颜色标记剥进 color；文本里无来源的字段是如实缺省，不是编造。
    expect(out.stickies).toEqual([
      { stickyId: "st-1", sectionId: "s1", text: "团队执行力强", color: null, size: null,
        authorRef: "", aiGenerated: false, citationRef: null },
      { stickyId: "st-2", sectionId: "s1", text: "独家渠道", color: "#bfdbfe", size: null,
        authorRef: "", aiGenerated: false, citationRef: null },
      { stickyId: "st-3", sectionId: "s2", text: "现金流紧张", color: null, size: null,
        authorRef: "", aiGenerated: false, citationRef: null },
    ]);
    // 白名单缺省 12 型全放行 ⇒ 零 ignored；mermaid 块进渲染面（诚实降级形状）。
    expect(out.ignoredSyntaxCount).toBe(0);
    expect(out.ignoredBlocks).toEqual([]);
    const model = JSON.parse(out.diagramModel) as { kind: string; blocks: Array<{ code: string }> };
    expect(model.kind).toBe("mermaid-source");
    expect(model.blocks[0]!.code).toContain("A-->B");

    // I-8 的 HTTP 面：render 是纯读——源码逐字节不变（asApp 重读，不信响应体）。
    expect(await readVersions(instanceId)).toEqual(before);
  });

  it("versionId 指定渲染历史版本（v1 只有空分区，没有便签）", async () => {
    const instanceId = await seedInstanceWithContent();
    const v1 = (await readVersions(instanceId))[0]!;
    const res = await render(instanceId, G1_MEMBER, `?versionId=${v1.id}`);
    expect(res.status).toBe(200);
    const out = C.operations.renderCanvas.out.parse(await res.json());
    expect(out.stickies).toEqual([]);
    expect(out.sections).toEqual(SECTIONS);
  });

  it("跨组只读放行（uc-7-3 A2）：g2 组员渲染 g1 画布 200", async () => {
    const instanceId = await seedInstanceWithContent();
    expect((await render(instanceId, G2_MEMBER)).status).toBe(200);
  });

  it("非项目成员 ⇒ 403 NO_PROJECT_ROLE", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await render(instanceId, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NO_PROJECT_ROLE");
  });

  it("别的组织的主体 ⇒ 404 INSTANCE_NOT_FOUND（RLS，不泄露存在性）", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await render(instanceId, "u-other", "", OTHER_ORG);
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("INSTANCE_NOT_FOUND");
  });
});

describe("#1493 · POST /canvas/instances/:id/export-source —— 几何归区导出", () => {
  it("拖进劣势框 ⇒ 归 s2、原文搬到 ## 劣势 下；I-9 反证：输出 markdown 不含任何数字；不落库", async () => {
    const instanceId = await seedInstanceWithContent();
    const before = await readVersions(instanceId);

    const res = await exportSource(instanceId, {
      instanceId,
      stickyPositions: [
        { stickyId: "st-1", x: 1190, y: 280 },   // 劣势框中心（引擎 swot 几何）
        { stickyId: "st-2", x: 430, y: 280 },    // 留在优势框内
        { stickyId: "st-3", x: -9999, y: -9999 }, // 全部框外 ⇒ 最近的优势框 + fallback
      ],
    }, G1_MEMBER);
    expect(res.status).toBe(200);
    const out = C.operations.exportSource.out.parse(await res.json());

    expect(out.assignments).toEqual([
      { stickyId: "st-1", sectionId: "s2", nearestFallback: false },
      { stickyId: "st-2", sectionId: "s1", nearestFallback: false },
      { stickyId: "st-3", sectionId: "s1", nearestFallback: true },
    ]);

    const [头部, 优势段, 劣势段] = out.markdown.split(/^## .*$/m);
    expect(头部).toContain("# SWOT 画布");
    expect(优势段).toContain("- 独家渠道 #blue");   // 颜色标记逐字保留
    expect(优势段).toContain("- 现金流紧张");        // fallback 归入优势
    expect(优势段).not.toContain("团队执行力强");
    expect(劣势段).toContain("- 团队执行力强");
    expect(劣势段).toContain("A-->B");              // mermaid 围栏原位保留

    // I-9 反证：MD 特意不含数字 ⇒ 输出里出现任何数字都只能来自坐标泄漏。
    expect(out.markdown).not.toMatch(/[0-9]/);

    // 不落库：没有版本推进，head 与 v2 逐字节不变（写回是调用方再走 updateSource）。
    expect(await readVersions(instanceId)).toEqual(before);
  });

  it("写别组画布的导出 ⇒ 403 NOT_IN_GROUP（组内动作，服务端拒绝）", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await exportSource(instanceId, {
      instanceId, stickyPositions: [],
    }, G2_MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NOT_IN_GROUP");
  });

  it("非项目成员 ⇒ 同一个 NOT_IN_GROUP 出口（err 闭集里没有 NO_PROJECT_ROLE）", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await exportSource(instanceId, {
      instanceId, stickyPositions: [],
    }, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NOT_IN_GROUP");
  });

  it("契约没描述的字段 ⇒ 400（.strict() 真的生效）", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await exportSource(instanceId, {
      instanceId, stickyPositions: [], versionId: "v-1",
    }, G1_MEMBER);
    expect(res.status).toBe(400);
  });

  it("路径与 body 的 instanceId 打架 ⇒ 400，不静默挑一个", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await exportSource(instanceId, {
      instanceId: "cvinst-other", stickyPositions: [],
    }, G1_MEMBER);
    expect(res.status).toBe(400);
  });
});
