/**
 * #1493（UC-7.3 第一块）—— 实例源码链端到端：
 * `instantiateForSegment`（含幂等重放）→ `getSource` → `updateSource`（乐观并发）。
 *
 * ## 每一条都走真 HTTP → controller → application → repository → PostgreSQL
 *
 * 持久面一律用 `asApp` 重新读一遍，不信响应体——同 `mint-template-version-http.test.ts`
 * 那条「一个把入参原样回显的实现与一次真的写入，在响应体上完全同形」的理由。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { initialMarkdownFor } from "../../src/application/canvas/instantiate-canvases-for-segment";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce,
  resetOrgs, seedAgendaSegment, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1493-inst";
const OTHER_ORG = "org-1493-other";
const FACILITATOR = "u-1493-fac";
const G1_MEMBER = "u-1493-g1";
const G2_MEMBER = "u-1493-g2";
const OUTSIDER = "u-1493-outsider"; // org 成员但非项目成员
const SEGMENT = "seg-1493-a";

let BASE: string;
let app: NestExpressApplication;
let g1 = "";
let g2 = "";
let projectId = "";

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

const instantiate = (body: unknown, userId = FACILITATOR, segment = SEGMENT) =>
  fetch(`${BASE}/canvas/agenda-segments/${segment}/instances`, {
    method: "POST", headers: authFor(userId), body: JSON.stringify(body),
  });

const getSource = (instanceId: string, userId: string, query = "", orgId = ORG) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/source${query}`, {
    headers: authFor(userId, orgId),
  });

const putSource = (instanceId: string, body: unknown, userId: string) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/source`, {
    method: "PUT", headers: authFor(userId), body: JSON.stringify(body),
  });

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

interface StoredInstance {
  id: string; group_id: string; template_key: string;
  template_version: number; head_version: number; idempotency_key: string;
}
interface StoredVersion {
  id: string; instance_id: string; version: number;
  markdown: string; content_hash: string; created_by: string;
}

const readInstances = () =>
  asApp(ORG, async (c) =>
    (await c.query<StoredInstance>(
      `SELECT id, group_id, template_key, template_version, head_version, idempotency_key
         FROM canvas_instances WHERE org_id = $1 ORDER BY group_id, template_key`,
      [ORG],
    )).rows,
  );

const readVersions = (instanceId: string) =>
  asApp(ORG, async (c) =>
    (await c.query<StoredVersion>(
      `SELECT id, instance_id, version, markdown, content_hash, created_by
         FROM canvas_instance_versions WHERE org_id = $1 AND instance_id = $2 ORDER BY version`,
      [ORG, instanceId],
    )).rows,
  );

/** published 模板 + 环节绑定，实例化的前置状态。 */
async function seedTemplateAndBinding(): Promise<void> {
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
       VALUES ('bind-1493-swot',$1,$2,$3,'swot',1)`,
      [ORG, SEGMENT, projectId],
    );
  });
}

/** 实例化一批并返回契约解析后的 out（大多数用例的起点）。 */
async function instantiateBoth(idempotencyKey = "idem-1") {
  const res = await instantiate({
    agendaSegmentId: SEGMENT, groupIds: [g1, g2], idempotencyKey,
  });
  expect(res.status).toBe(200);
  return C.operations.instantiateForSegment.out.parse(await res.json());
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
  await seedTemplateAndBinding();
  await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-workshop` });
  await addOrgMember(OTHER_ORG, "u-other", "consultant", null);
});

describe("#1493 · POST /canvas/agenda-segments/:id/instances 真的为每组出一张画布", () => {
  it("200，响应逐字过契约 strict 校验；每组一行实例 + v1 初始版本落库", async () => {
    const out = await instantiateBoth();
    expect(out.instances).toHaveLength(2);
    expect(out.instances.map((i) => i.groupId).sort()).toEqual([g1, g2].sort());
    for (const inst of out.instances) {
      expect(inst.templateKey).toBe("swot");
      expect(inst.templateVersion).toBe(1); // I-4：冻结绑定当时的版本
    }

    // 持久面：asApp 重读，不信响应体。
    const rows = await readInstances();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.head_version).toBe(1);
      const versions = await readVersions(row.id);
      expect(versions).toHaveLength(1);
      // 初始源码 = `# 模板显示名` + 每分区一个 `## 段落`（导出约定的既有形状）。
      expect(versions[0]!.markdown).toBe(initialMarkdownFor("SWOT 画布", [
        { name: "优势", order: 0 }, { name: "劣势", order: 1 },
      ]));
      expect(versions[0]!.markdown).toContain("## 优势");
      // sourceArtifactId = v1 版本行 id（命名遗留，见 instance-ports.ts）。
      const fromOut = out.instances.find((i) => i.instanceId === row.id)!;
      expect(fromOut.sourceArtifactId).toBe(versions[0]!.id);
    }
  });

  it("幂等重放：同 idempotencyKey 第二次调用返回同一批 instanceId，不产生第二批", async () => {
    const first = await instantiateBoth("idem-replay");
    const second = await instantiateBoth("idem-replay");
    expect(second).toEqual(first);
    expect(await readInstances()).toHaveLength(2);
  });

  it("不同 idempotencyKey 是新的一批（幂等键只对同一次现场重试生效）", async () => {
    await instantiateBoth("idem-a");
    const res = await instantiate({ agendaSegmentId: SEGMENT, groupIds: [g1], idempotencyKey: "idem-b" });
    expect(res.status).toBe(200);
    expect(await readInstances()).toHaveLength(3);
  });

  it("组员（非引导师）⇒ 403 ROLE_INSUFFICIENT，一行都没建", async () => {
    const res = await instantiate({ agendaSegmentId: SEGMENT, groupIds: [g1], idempotencyKey: "k" }, G1_MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readInstances()).toHaveLength(0);
  });

  it("环节不存在（或属于别的组织）⇒ 404，无泄露", async () => {
    const res = await instantiate(
      { agendaSegmentId: "seg-never", groupIds: [g1], idempotencyKey: "k" },
      FACILITATOR, "seg-never",
    );
    expect(res.status).toBe(404);
  });

  it("路径与 body 的 agendaSegmentId 打架 ⇒ 400，不静默挑一个", async () => {
    const res = await instantiate(
      { agendaSegmentId: "seg-other", groupIds: [g1], idempotencyKey: "k" },
    );
    expect(res.status).toBe(400);
  });
});

describe("#1493 · GET /canvas/instances/:id/source —— [源码] 读取", () => {
  it("组员读本组画布：200，markdown/versionId/contentHash 与库里 v1 一致", async () => {
    const out = await instantiateBoth();
    const mine = out.instances.find((i) => i.groupId === g1)!;
    const res = await getSource(mine.instanceId, G1_MEMBER);
    expect(res.status).toBe(200);
    const parsed = C.operations.getSource.out.parse(await res.json());

    const versions = await readVersions(mine.instanceId);
    expect(parsed.markdown).toBe(versions[0]!.markdown);
    expect(parsed.versionId).toBe(versions[0]!.id);
    expect(parsed.contentHash).toBe(versions[0]!.content_hash);
  });

  it("跨组只读放行（uc-7-3 A2）：g2 组员读 g1 画布 200", async () => {
    const out = await instantiateBoth();
    const g1Canvas = out.instances.find((i) => i.groupId === g1)!;
    expect((await getSource(g1Canvas.instanceId, G2_MEMBER)).status).toBe(200);
  });

  it("非项目成员 ⇒ 403 NO_PROJECT_ROLE", async () => {
    const out = await instantiateBoth();
    const res = await getSource(out.instances[0]!.instanceId, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NO_PROJECT_ROLE");
  });

  it("别的组织的主体 ⇒ 404 INSTANCE_NOT_FOUND（RLS，不泄露存在性）", async () => {
    const out = await instantiateBoth();
    const res = await getSource(out.instances[0]!.instanceId, "u-other", "", OTHER_ORG);
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("INSTANCE_NOT_FOUND");
  });

  it("versionId 指定读历史版本", async () => {
    const out = await instantiateBoth();
    const mine = out.instances.find((i) => i.groupId === g1)!;
    await putSource(mine.instanceId, {
      instanceId: mine.instanceId, markdown: "# 改过\n", expectedHeadVersion: 1,
    }, G1_MEMBER);
    const v1 = (await readVersions(mine.instanceId))[0]!;
    const res = await getSource(mine.instanceId, G1_MEMBER, `?versionId=${v1.id}`);
    const parsed = C.operations.getSource.out.parse(await res.json());
    expect(parsed.versionId).toBe(v1.id);
    expect(parsed.markdown).toBe(v1.markdown); // 历史版本逐字节不动
  });
});

describe("#1493 · PUT /canvas/instances/:id/source —— 手改 + 乐观并发", () => {
  const NEW_MD = "# SWOT 画布\n\n## 优势\n\n改过的内容\n\n```mermaid\nflowchart TD\n  A-->B\n```\n";

  it("成功：追加 v2、head 推进、响应过契约校验，v1 逐字节不动", async () => {
    const out = await instantiateBoth();
    const mine = out.instances.find((i) => i.groupId === g1)!;
    const before = (await readVersions(mine.instanceId))[0]!;

    const res = await putSource(mine.instanceId, {
      instanceId: mine.instanceId, markdown: NEW_MD, expectedHeadVersion: 1,
    }, G1_MEMBER);
    expect(res.status).toBe(200);
    const parsed = C.operations.updateSource.out.parse(await res.json());
    // 白名单未配置 = 12 型全放行 ⇒ 没有被忽略的语法。
    expect(parsed.ignoredSyntaxCount).toBe(0);
    // Node 端能力边界：diagramModel 是提取块原文的 JSON 包装（见 update-canvas-source.ts）。
    const model = JSON.parse(parsed.diagramModel) as { kind: string; blocks: Array<{ code: string }> };
    expect(model.kind).toBe("mermaid-source");
    expect(model.blocks[0]!.code).toContain("A-->B");

    const versions = await readVersions(mine.instanceId);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual(before); // immutable：v1 一个字节没变
    expect(versions[1]!.version).toBe(2);
    expect(versions[1]!.markdown).toBe(NEW_MD);
    expect(versions[1]!.id).toBe(parsed.versionId);
    expect(versions[1]!.content_hash).toBe(parsed.contentHash);
    expect(versions[1]!.created_by).toBe(G1_MEMBER);
    const head = (await readInstances()).find((r) => r.id === mine.instanceId)!;
    expect(head.head_version).toBe(2);
  });

  it("expectedHeadVersion 过期 ⇒ 409 VERSION_CHANGED，不追加任何版本（E4 不静默覆盖）", async () => {
    const out = await instantiateBoth();
    const mine = out.instances.find((i) => i.groupId === g1)!;
    await putSource(mine.instanceId, {
      instanceId: mine.instanceId, markdown: "# v2\n", expectedHeadVersion: 1,
    }, G1_MEMBER);

    const stale = await putSource(mine.instanceId, {
      instanceId: mine.instanceId, markdown: "# 基于旧版的改动\n", expectedHeadVersion: 1,
    }, G1_MEMBER);
    expect(stale.status).toBe(409);
    expect(await reasonCodeOf(stale)).toBe("VERSION_CHANGED");
    expect(await readVersions(mine.instanceId)).toHaveLength(2); // 没有 v3
    expect((await readInstances()).find((r) => r.id === mine.instanceId)!.head_version).toBe(2);
  });

  it("写别组画布 ⇒ 403 NOT_IN_GROUP，服务端拒绝而不是前端置灰（A2）", async () => {
    const out = await instantiateBoth();
    const g1Canvas = out.instances.find((i) => i.groupId === g1)!;
    const res = await putSource(g1Canvas.instanceId, {
      instanceId: g1Canvas.instanceId, markdown: "# 越权\n", expectedHeadVersion: 1,
    }, G2_MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NOT_IN_GROUP");
    expect(await readVersions(g1Canvas.instanceId)).toHaveLength(1);
  });

  it("非项目成员写 ⇒ 同一个 NOT_IN_GROUP 出口（err 闭集里没有 NO_PROJECT_ROLE）", async () => {
    const out = await instantiateBoth();
    const inst = out.instances[0]!;
    const res = await putSource(inst.instanceId, {
      instanceId: inst.instanceId, markdown: "# 越权\n", expectedHeadVersion: 1,
    }, OUTSIDER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("NOT_IN_GROUP");
  });

  it("契约没描述的字段 ⇒ 400（.strict() 真的生效）", async () => {
    const out = await instantiateBoth();
    const inst = out.instances.find((i) => i.groupId === g1)!;
    const res = await putSource(inst.instanceId, {
      instanceId: inst.instanceId, markdown: "# x\n", expectedHeadVersion: 1, force: true,
    }, G1_MEMBER);
    expect(res.status).toBe(400);
    expect(await readVersions(inst.instanceId)).toHaveLength(1);
  });
});
