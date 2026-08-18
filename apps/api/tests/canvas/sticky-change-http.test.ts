/**
 * #1493（UC-7.3 第三块）—— `classifyChange` + `applyStickyChange` 端到端：
 * 真 HTTP → controller → application → repository → PostgreSQL
 * （同 `render-export-http.test.ts` 的纪律：持久面一律 asApp 重读，不信响应体）。
 *
 * · classifyChange：**差集断言**——HTTP 上逐 kind 打一遍，得到的映射与 domain 判定表
 *   `CLASSIFICATION_TABLE_ENTRIES` 完全相等（不是抽查几行）；O-32 反证单独点名。
 * · applyStickyChange：改文本 / 换色 / 跨区移动各一条 + LWW 后写覆盖先写 +
 *   目标行外逐字节不变（反证）+ I-19（被覆盖修订可回查）+ 越权 / 未认证。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  CHANGE_KINDS,
  CLASSIFICATION_TABLE_ENTRIES,
} from "../../src/domain/canvas/change-classification";
import {
  addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce,
  resetOrgs, seedAgendaSegment, seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1493-sc";
const OTHER_ORG = "org-1493-sc-other";
const FACILITATOR = "u-1493sc-fac";
const G1_MEMBER = "u-1493sc-g1";
const G2_MEMBER = "u-1493sc-g2";
const OUTSIDER = "u-1493sc-outsider"; // org 成员但非项目成员
const SEGMENT = "seg-1493-sc";

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

/** 两个分区、三张便签（st-1/st-2 在优势，st-3 在劣势）+ 一个 mermaid 块。 */
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

const classify = (instanceId: string, kind: string, userId = G1_MEMBER, orgId = ORG) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/classify-change`, {
    method: "POST", headers: authFor(userId, orgId),
    body: JSON.stringify({ instanceId, change: { kind, targetId: null, payload: null } }),
  });

const stickyChange = (
  instanceId: string,
  body: Record<string, unknown>,
  userId = G1_MEMBER,
  orgId = ORG,
) =>
  fetch(`${BASE}/canvas/instances/${instanceId}/sticky-changes`, {
    method: "POST", headers: authFor(userId, orgId),
    body: JSON.stringify({ instanceId, ...body }),
  });

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

const readHead = (instanceId: string) =>
  asApp(ORG, async (c) =>
    (await c.query<{ version: number; markdown: string }>(
      `SELECT v.version, v.markdown FROM canvas_instance_versions v
         JOIN canvas_instances i ON i.id = v.instance_id
        WHERE v.org_id = $1 AND v.instance_id = $2 AND v.version = i.head_version`,
      [ORG, instanceId],
    )).rows[0]!,
  );

const readRevisions = (instanceId: string, stickyId: string) =>
  asApp(ORG, async (c) =>
    (await c.query<{ id: string; client_ts: string; is_current: boolean; patch: unknown }>(
      `SELECT id, client_ts, is_current, patch FROM canvas_sticky_revisions
        WHERE org_id = $1 AND instance_id = $2 AND sticky_id = $3 ORDER BY created_at, id`,
      [ORG, instanceId, stickyId],
    )).rows,
  );

async function seedInstanceWithContent(): Promise<string> {
  const res = await fetch(`${BASE}/canvas/agenda-segments/${SEGMENT}/instances`, {
    method: "POST", headers: authFor(FACILITATOR),
    body: JSON.stringify({ agendaSegmentId: SEGMENT, groupIds: [g1], idempotencyKey: "idem-sc" }),
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
       VALUES ('bind-1493-sc',$1,$2,$3,'swot',1)`,
      [ORG, SEGMENT, projectId],
    );
  });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-workshop` });
  await addOrgMember(OTHER_ORG, "u-other", "consultant", null);
});

describe("#1493 · POST /canvas/instances/:id/classify-change —— 判定表暴露（I-15）", () => {
  it("差集断言：HTTP 上逐 kind 归类的结果 = domain 判定表全部七行，一行不多一行不少", async () => {
    const instanceId = await seedInstanceWithContent();

    const viaHttp = new Map<string, string>();
    for (const kind of CHANGE_KINDS) {
      const res = await classify(instanceId, kind);
      expect(res.status).toBe(200);
      const out = C.operations.classifyChange.out.parse(await res.json());
      viaHttp.set(kind, out.classification);
    }
    // 全等（不是抽查）：七行覆盖全部改动类型，服务端是判定表唯一实现。
    expect(viaHttp).toEqual(new Map(CLASSIFICATION_TABLE_ENTRIES));
  });

  it("O-32 反证：跨区移动（sticky-section-move）= 便签级，不是结构性", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await classify(instanceId, "sticky-section-move");
    expect(res.status).toBe(200);
    expect((await res.json() as { classification: string }).classification).toBe("sticky-level");
  });

  it("未知 kind 保守归 structural（全函数：不 500、不 undefined）", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await classify(instanceId, "some-future-kind");
    expect(res.status).toBe(200);
    expect((await res.json() as { classification: string }).classification).toBe("structural");
  });

  it("实例不存在 / 别组织的实例 → 404 INSTANCE_NOT_FOUND（同一个出口）", async () => {
    const missing = await classify("cvinst-nope", "sticky-text");
    expect(missing.status).toBe(404);
    expect(await reasonCodeOf(missing)).toBe("INSTANCE_NOT_FOUND");

    const instanceId = await seedInstanceWithContent();
    const crossOrg = await classify(instanceId, "sticky-text", "u-other", OTHER_ORG);
    expect(crossOrg.status).toBe(404);
    expect(await reasonCodeOf(crossOrg)).toBe("INSTANCE_NOT_FOUND");
  });

  it("未认证 → 401", async () => {
    const instanceId = await seedInstanceWithContent();
    const res = await fetch(`${BASE}/canvas/instances/${instanceId}/classify-change`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, change: { kind: "sticky-text", targetId: null, payload: null } }),
    });
    expect(res.status).toBe(401);
  });
});

describe("#1493 · POST /canvas/instances/:id/sticky-changes —— 便签级 LWW（D-09）", () => {
  it("改文本：目标行原位替换，其余行逐字节不变（反证）；版本推进 + head 跟进", async () => {
    const instanceId = await seedInstanceWithContent();
    const before = await readHead(instanceId);
    expect(before.version).toBe(2);

    const res = await stickyChange(instanceId, {
      stickyId: "st-1",
      patch: { text: "团队执行力极强" },
      clientTs: "2026-08-18T10:00:00.000Z",
    });
    expect(res.status).toBe(200);
    const out = C.operations.applyStickyChange.out.parse(await res.json());
    expect(out.stickyId).toBe("st-1");
    expect(out.appliedTs).toBe("2026-08-18T10:00:00.000Z");
    expect(out.supersededRevisionId).toBeNull(); // 第一次写这张便签

    const after = await readHead(instanceId);
    expect(after.version).toBe(3);
    const beforeLines = before.markdown.split("\n");
    const afterLines = after.markdown.split("\n");
    expect(afterLines.length).toBe(beforeLines.length);
    // 反证：唯一变化的行是 st-1 的那一行（MD 里 1-based 第 5 行 = 索引 4）。
    for (let i = 0; i < beforeLines.length; i++) {
      if (i === 4) expect(afterLines[i]).toBe("- 团队执行力极强");
      else expect(afterLines[i]).toBe(beforeLines[i]);
    }
  });

  it("换色：尾部 ` #颜色名` 标记承载（hex 与名字都收）；缺省黄不写标记", async () => {
    const instanceId = await seedInstanceWithContent();
    // st-2（独家渠道 #blue）→ green（用 hex 提交，验证 hex 反查名字）。
    const res = await stickyChange(instanceId, {
      stickyId: "st-2",
      patch: { color: "#bbf7d0" },
      clientTs: "2026-08-18T10:01:00.000Z",
    });
    expect(res.status).toBe(200);
    let head = await readHead(instanceId);
    expect(head.markdown.split("\n")[5]).toBe("- 独家渠道 #green");

    // 换回缺省黄：标记消失（引擎序列化约定：yellow 不写标记）。
    const back = await stickyChange(instanceId, {
      stickyId: "st-2",
      patch: { color: "yellow" },
      clientTs: "2026-08-18T10:02:00.000Z",
    });
    expect(back.status).toBe(200);
    head = await readHead(instanceId);
    expect(head.markdown.split("\n")[5]).toBe("- 独家渠道");

    // 未注册颜色：裸 400（契约 err 闭集没有码，不借用）。
    const bad = await stickyChange(instanceId, {
      stickyId: "st-2", patch: { color: "mauve" }, clientTs: "2026-08-18T10:03:00.000Z",
    });
    expect(bad.status).toBe(400);
  });

  it("跨区移动（O-32 便签级）：原行删除、目标段落末尾追加、颜色标记原样搬运；其余行不变", async () => {
    const instanceId = await seedInstanceWithContent();
    const before = await readHead(instanceId);
    // st-2（优势/独家渠道 #blue）→ 劣势（用冻结模板 sectionId）。
    const res = await stickyChange(instanceId, {
      stickyId: "st-2",
      patch: { sectionId: "s2" },
      clientTs: "2026-08-18T10:04:00.000Z",
    });
    expect(res.status).toBe(200);

    const after = await readHead(instanceId);
    const beforeLines = before.markdown.split("\n");
    const afterLines = after.markdown.split("\n");
    // 原第 6 行（索引 5）被删；追加锚点 = 目标段落区间内最后一条非空行
    // （export-canvas-source.ts 的同一条规则）——这里是 mermaid 闭围栏行之后。
    const expected = [...beforeLines];
    expected.splice(5, 1); // 删原行
    const anchor = expected.lastIndexOf("```");
    expected.splice(anchor + 1, 0, "- 独家渠道 #blue");
    expect(afterLines).toEqual(expected);

    // 未知目标分区：裸 400。
    const bad = await stickyChange(instanceId, {
      stickyId: "st-1", patch: { sectionId: "s-nope" }, clientTs: "2026-08-18T10:05:00.000Z",
    });
    expect(bad.status).toBe(400);
  });

  it("position/size：markdown 里没有承载（I-9 坐标不写回）——修订落库、文本与版本都不动", async () => {
    const instanceId = await seedInstanceWithContent();
    const before = await readHead(instanceId);
    const res = await stickyChange(instanceId, {
      stickyId: "st-1",
      patch: { position: { x: 120, y: 88 }, size: "large" },
      clientTs: "2026-08-18T10:06:00.000Z",
    });
    expect(res.status).toBe(200);
    const after = await readHead(instanceId);
    expect(after.version).toBe(before.version); // 不推进版本
    expect(after.markdown).toBe(before.markdown); // 一个字节不动
    const revs = await readRevisions(instanceId, "st-1");
    expect(revs.length).toBe(1); // 但修订落了库（可查、可回放）
    expect(revs[0]!.is_current).toBe(true);
  });

  it("LWW：后写覆盖先写，supersededRevisionId 指向被覆盖那次且可回查（I-19）", async () => {
    const instanceId = await seedInstanceWithContent();
    const first = await stickyChange(instanceId, {
      stickyId: "st-3", patch: { text: "现金流非常紧张" }, clientTs: "2026-08-18T11:00:00.000Z",
    });
    expect(first.status).toBe(200);
    const firstOut = C.operations.applyStickyChange.out.parse(await first.json());

    const second = await stickyChange(instanceId, {
      stickyId: "st-3", patch: { text: "现金流已断" }, clientTs: "2026-08-18T11:00:01.000Z",
    });
    expect(second.status).toBe(200);
    const secondOut = C.operations.applyStickyChange.out.parse(await second.json());
    expect(secondOut.appliedTs).toBe("2026-08-18T11:00:01.000Z");
    expect(secondOut.supersededRevisionId).not.toBeNull();

    // I-19：被覆盖的修订还在库里，能按 id 查到，且不再是 current。
    const revs = await readRevisions(instanceId, "st-3");
    const superseded = revs.find((r) => r.id === secondOut.supersededRevisionId);
    expect(superseded).toBeDefined();
    expect(superseded!.is_current).toBe(false);
    expect(superseded!.client_ts).toBe("2026-08-18T11:00:00.000Z");
    expect(revs.filter((r) => r.is_current).length).toBe(1);

    // 后写生效在文本上。
    const head = await readHead(instanceId);
    expect(head.markdown).toContain("- 现金流已断");
    expect(head.markdown).not.toContain("现金流非常紧张");
    expect(firstOut.supersededRevisionId).toBeNull();
  });

  it("LWW：迟到的、clientTs 更早的写不覆盖——文本不变、落历史行、supersededRevisionId=null", async () => {
    const instanceId = await seedInstanceWithContent();
    const newer = await stickyChange(instanceId, {
      stickyId: "st-3", patch: { text: "断线前最新的话" }, clientTs: "2026-08-18T12:00:10.000Z",
    });
    expect(newer.status).toBe(200);
    const headBefore = await readHead(instanceId);

    // 断线重连的重放：到达更晚、clientTs 更早。
    const late = await stickyChange(instanceId, {
      stickyId: "st-3", patch: { text: "重放的旧改动" }, clientTs: "2026-08-18T12:00:05.000Z",
    });
    expect(late.status).toBe(200);
    const lateOut = C.operations.applyStickyChange.out.parse(await late.json());
    expect(lateOut.appliedTs).toBe("2026-08-18T12:00:10.000Z"); // 当前生效的仍是先赢那次
    expect(lateOut.supersededRevisionId).toBeNull();

    const headAfter = await readHead(instanceId);
    expect(headAfter.markdown).toBe(headBefore.markdown); // 文本一个字节不动、版本不推进
    expect(headAfter.version).toBe(headBefore.version);
    const revs = await readRevisions(instanceId, "st-3");
    expect(revs.length).toBe(2); // 迟到写仍留痕（「不弹冲突条」≠「没有留痕」）
    expect(revs.filter((r) => r.is_current).length).toBe(1);
  });

  it("越权：别组成员 / 非项目成员 → 403 NOT_IN_GROUP（同一个出口）；未认证 → 401", async () => {
    const instanceId = await seedInstanceWithContent();
    const body = {
      stickyId: "st-1", patch: { text: "越权改动" }, clientTs: "2026-08-18T13:00:00.000Z",
    };
    const g2res = await stickyChange(instanceId, body, G2_MEMBER);
    expect(g2res.status).toBe(403);
    expect(await reasonCodeOf(g2res)).toBe("NOT_IN_GROUP");

    const outres = await stickyChange(instanceId, body, OUTSIDER);
    expect(outres.status).toBe(403);
    expect(await reasonCodeOf(outres)).toBe("NOT_IN_GROUP");

    const anon = await fetch(`${BASE}/canvas/instances/${instanceId}/sticky-changes`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instanceId, ...body }),
    });
    expect(anon.status).toBe(401);

    // 越权与未认证都没在库里留任何痕迹。
    const revs = await readRevisions(instanceId, "st-1");
    expect(revs.length).toBe(0);

    // stickyId 陈旧（head 里没有）→ 裸 404（契约缺口，errors.ts 论证）。
    const stale = await stickyChange(instanceId, {
      stickyId: "st-99", patch: { text: "x" }, clientTs: "2026-08-18T13:01:00.000Z",
    });
    expect(stale.status).toBe(404);

    const missing = await stickyChange("cvinst-nope", body);
    expect(missing.status).toBe(404);
    expect(await reasonCodeOf(missing)).toBe("INSTANCE_NOT_FOUND");
  });
});
