/**
 * #463 — the canvas template registry's HTTP boundary, end to end.
 *
 * ## Why this file exists at all
 *
 * `tests/canvas/publish-archive-instance-version.test.ts` already exhausts the 4×4 lifecycle
 * matrix — and every one of its assertions runs against pure functions in `domain/canvas/`.
 * F100/F101/F102 are all marked `passing` on the strength of tests exactly like it, while
 * `apps/api/src/application/canvas/` did not exist, no controller served `/canvas/templates`,
 * and no table stored a template. The domain was green and unreachable.
 *
 * So nothing in this file asserts against a pure function. Every assertion goes
 * **real HTTP → controller → application → repository → PostgreSQL**, and the durable side is
 * re-read with `asApp` (the app role, under RLS) rather than trusted from the response body:
 * a response can echo the caller's own request and look identical to a write that happened.
 *
 * ## Where the draft rows come from, and why the fixture inserts them
 *
 * ⚠ **The signed `canvas.ts` contract has no operation that creates a template.** Its five
 * registry operations are `listTemplates` / `publishTemplate` / `trialTemplate` /
 * `archiveTemplate` / `restoreTemplate`, and `publishTemplate.in` is `{key, version,
 * visibility}` — it carries no `displayName`, no `sections`, no `underlyingType`, and its
 * `err` union contains `TEMPLATE_NOT_FOUND`, so it reads an existing row rather than minting
 * one. That gap is reported on #463; it is NOT closed here by inventing a `POST
 * /canvas/templates`, because the contract is the single source and it is signed.
 *
 * Seeding drafts through SQL is therefore the honest shape: this file tests the five
 * operations that exist, and the absence of a sixth stays visible instead of being papered
 * over by an endpoint nobody reviewed.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import {
  addOrgMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedAgendaSegment,
  seedOrg,
} from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-463-canvas-tpl";
const OTHER_ORG = "org-463-canvas-tpl-other";
const PROJECT = `${ORG}-workshop`;
const OTHER_PROJECT = `${OTHER_ORG}-workshop`;
const SEGMENT_A = `${PROJECT}-seg-a`;
const SEGMENT_B = `${PROJECT}-seg-b`;
const ADMIN = "u-463-admin";
const MEMBER = "u-463-member";
const OUTSIDER = "u-463-outsider";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});


/** `res.json()` 回的是 `unknown`；只取 reasonCode 一个字段，不把整个体当成已知形状。 */
async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

interface SeedTemplate {
  readonly orgId?: string;
  readonly key: string;
  readonly version: number;
  readonly status: "draft" | "trial" | "published" | "archived";
  readonly archivedFrom?: "draft" | "trial" | "published" | null;
  readonly builtin?: boolean;
  readonly visibility?: "org-wide" | "team-only";
  readonly displayName?: string;
}

async function seedTemplate(t: SeedTemplate): Promise<void> {
  const orgId = t.orgId ?? ORG;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        orgId,
        t.key,
        t.version,
        t.displayName ?? t.key,
        t.status,
        t.archivedFrom ?? null,
        t.builtin ?? false,
        t.visibility ?? "org-wide",
        "canvas",
        JSON.stringify(SECTIONS),
      ],
    ),
  );
}

async function seedBinding(opts: {
  bindingId: string;
  segmentId: string;
  key: string;
  version: number;
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO canvas_template_bindings
         (id, org_id, agenda_segment_id, workshop_id, template_key, template_version)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [opts.bindingId, ORG, opts.segmentId, PROJECT, opts.key, opts.version],
    ),
  );
}

async function readTemplate(
  key: string,
  version: number,
  orgId = ORG,
): Promise<{ status: string; archived_from: string | null } | null> {
  return asApp(orgId, async (c) => {
    const r = await c.query<{ status: string; archived_from: string | null }>(
      "SELECT status, archived_from FROM canvas_templates WHERE org_id=$1 AND key=$2 AND version=$3",
      [orgId, key, version],
    );
    return r.rows[0] ?? null;
  });
}

const listTemplates = (query: string, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}/canvas/templates?orgId=${orgId}&${query}`, { headers: authFor(userId, orgId) });

const post = (path: string, body: unknown, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}/canvas${path}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  // Port 0 -- the OS picks a free one, so parallel test files cannot collide and a run that
  // died holding a fixed port does not wedge the next one.
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
  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_PROJECT });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy!);
  // `consultant`, not `lead`: the point of this fixture is an ordinary member, and `lead` is
  // senior enough that a wrong role gate could still let it through and look correct.
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy!);
  await seedAgendaSegment(ORG, PROJECT, SEGMENT_A);
  await seedAgendaSegment(ORG, PROJECT, SEGMENT_B);
});

describe("#463 · GET /canvas/templates 真的读库，且响应体逐字过契约", () => {
  it("未配置的组织返回空数组 —— 没有内置回退清单", async () => {
    const res = await listTemplates("");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Parsed with the contract's own `.strict()` schema: an extra field the contract does
    // not describe fails here rather than being discovered by the frontend at integration.
    const parsed = C.operations.listTemplates.out.parse(body);
    expect(parsed.templates).toEqual([]);
  });

  it("已入库的模板从库里读出来，字段与契约同形", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published", displayName: "swot" });
    const res = await listTemplates("");
    const parsed = C.operations.listTemplates.out.parse(await res.json());
    expect(parsed.templates).toHaveLength(1);
    expect(parsed.templates[0]).toMatchObject({
      key: "swot",
      version: 1,
      status: "published",
      builtin: false,
      visibility: "org-wide",
      underlyingType: "canvas",
      usageCount: 0,
    });
    expect(parsed.templates[0]!.sections).toEqual(SECTIONS);
  });

  it("非成员看不到本组织的模板库（NO_PROJECT_ROLE，不是空列表）", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await listTemplates("", OUTSIDER);
    expect(res.status).toBe(403);
    // ⚠ The reasonCode surviving the exception filter is the assertion, not the 403.
    //   `canvas.CanvasError` was not registered in `all-exceptions.filter.ts` before #463;
    //   without that registration this body is a bare `{"error":"forbidden"}` and the
    //   frontend cannot tell this apart from any other denial.
    expect(await reasonCodeOf(res)).toBe("NO_PROJECT_ROLE");
  });

  it("租户隔离：另一组织的模板不出现在本组织的列表里", async () => {
    await seedTemplate({ orgId: OTHER_ORG, key: "pestel", version: 1, status: "published" });
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const parsed = C.operations.listTemplates.out.parse(await (await listTemplates("")).json());
    expect(parsed.templates.map((t) => t.key)).toEqual(["swot"]);
  });
});

describe("#463 · 归档语义 O-10：置位不删除，默认列表藏起来，按归档筛选看得见", () => {
  beforeEach(async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await seedTemplate({ key: "jtbd", version: 1, status: "draft" });
    await seedTemplate({ key: "mvp", version: 1, status: "trial" });
    await seedTemplate({ key: "hmw", version: 1, status: "archived", archivedFrom: "published" });
  });

  it("不带 filter：归档的不出现", async () => {
    const parsed = C.operations.listTemplates.out.parse(await (await listTemplates("")).json());
    expect(parsed.templates.map((t) => t.key).sort()).toEqual(["jtbd", "mvp", "swot"]);
  });

  it("filter=archived：只出现归档的", async () => {
    const parsed = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=archived")).json(),
    );
    expect(parsed.templates.map((t) => t.key)).toEqual(["hmw"]);
  });

  it("filter=all：四个状态全出现", async () => {
    const parsed = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=all")).json(),
    );
    expect(parsed.templates.map((t) => t.key).sort()).toEqual(["hmw", "jtbd", "mvp", "swot"]);
  });

  it("filter=published / filter=draft 各自只出一档", async () => {
    const published = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=published")).json(),
    );
    expect(published.templates.map((t) => t.key)).toEqual(["swot"]);
    const draft = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=draft")).json(),
    );
    expect(draft.templates.map((t) => t.key)).toEqual(["jtbd"]);
  });

  it("forBinding=true：只有 published 能被新绑定（I-5，与 canCreateNewBinding 同一判据）", async () => {
    const parsed = C.operations.listTemplates.out.parse(
      await (await listTemplates("forBinding=true")).json(),
    );
    expect(parsed.templates.map((t) => t.key)).toEqual(["swot"]);
  });
});

describe("#463 · publishTemplate：旧版自动归档（I-4 前半），且是数据库层面的互斥", () => {
  it("首次发布一个 draft：状态落库为 published，archivedVersions 为空", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "draft" });
    const res = await post("/templates/swot/publish", {
      key: "swot",
      version: 1,
      visibility: "org-wide",
    });
    expect(res.status).toBe(200);
    const parsed = C.operations.publishTemplate.out.parse(await res.json());
    expect(parsed).toEqual({ key: "swot", version: 1, status: "published", archivedVersions: [] });
    // Re-read from PostgreSQL: the response above could be an echo of the request.
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "published" });
  });

  it("发布 v2：v1 自动归档，且 archivedVersions 点名了它", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await seedTemplate({ key: "swot", version: 2, status: "draft" });
    const res = await post("/templates/swot/publish", {
      key: "swot",
      version: 2,
      visibility: "org-wide",
    });
    const parsed = C.operations.publishTemplate.out.parse(await res.json());
    expect(parsed.archivedVersions).toEqual([{ key: "swot", version: 1 }]);
    expect(await readTemplate("swot", 1)).toMatchObject({
      status: "archived",
      archived_from: "published",
    });
    expect(await readTemplate("swot", 2)).toMatchObject({ status: "published" });
  });

  it("不同 key 的 published 版本不受影响", async () => {
    await seedTemplate({ key: "pestel", version: 1, status: "published" });
    await seedTemplate({ key: "swot", version: 1, status: "draft" });
    await post("/templates/swot/publish", { key: "swot", version: 1, visibility: "org-wide" });
    expect(await readTemplate("pestel", 1)).toMatchObject({ status: "published" });
  });

  /**
   * 反证：把「旧版自动归档」写成应用层的一次 UPDATE，只要漏掉一条分支就会留下两个
   * published，而上面那些断言仍然全绿（它们只看被点名的那两行）。这条直接绕过 HTTP，
   * 用 app 角色去插第二个 published —— 数据库必须拒绝。
   */
  it("反证：同一 key 在库里放不下两个 published（部分唯一索引，不是应用层自觉）", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await expect(seedTemplate({ key: "swot", version: 2, status: "published" })).rejects.toThrow(
      /canvas_templates_one_published_per_key|duplicate key/i,
    );
  });

  it("发布不存在的 key：404 且 reasonCode 是契约里的 TEMPLATE_NOT_FOUND", async () => {
    const res = await post("/templates/nope/publish", {
      key: "nope",
      version: 1,
      visibility: "org-wide",
    });
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
  });

  it("普通成员发布：403 ROLE_INSUFFICIENT，且库里状态没动", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "draft" });
    const res = await post(
      "/templates/swot/publish",
      { key: "swot", version: 1, visibility: "org-wide" },
      MEMBER,
    );
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "draft" });
  });

  it("租户隔离：拿别的组织的 key 来发布，看到的是 TEMPLATE_NOT_FOUND", async () => {
    await seedTemplate({ orgId: OTHER_ORG, key: "pestel", version: 1, status: "draft" });
    const res = await post("/templates/pestel/publish", {
      key: "pestel",
      version: 1,
      visibility: "org-wide",
    });
    expect(res.status).toBe(404);
    expect(await readTemplate("pestel", 1, OTHER_ORG)).toMatchObject({ status: "draft" });
  });

  it("路径参数与 body 的 key 打架时拒绝，不静默挑一个", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "draft" });
    const res = await post("/templates/swot/publish", {
      key: "pestel",
      version: 1,
      visibility: "org-wide",
    });
    expect(res.status).toBe(400);
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "draft" });
  });
});

describe("#463 · trialTemplate", () => {
  it("draft → trial，落库", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "draft" });
    const res = await post("/templates/swot/trial", {
      key: "swot",
      version: 1,
      projectId: PROJECT,
    });
    expect(res.status).toBe(200);
    expect(C.operations.trialTemplate.out.parse(await res.json())).toEqual({
      key: "swot",
      version: 1,
      status: "trial",
    });
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "trial" });
  });

  it("published 状态下试跑是非法转移：400，且库里没动（契约没有对应错误码，故是裸 400）", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await post("/templates/swot/trial", {
      key: "swot",
      version: 1,
      projectId: PROJECT,
    });
    expect(res.status).toBe(400);
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "published" });
  });
});

describe("#463 · archiveTemplate：预检不写库，归档不删行，存量绑定照样解析得出来", () => {
  beforeEach(async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    await seedBinding({ bindingId: "b1", segmentId: SEGMENT_A, key: "swot", version: 1 });
    await seedBinding({ bindingId: "b2", segmentId: SEGMENT_B, key: "swot", version: 1 });
  });

  it("usageCount 是真实计数，不是估算 —— 两条绑定就是 2", async () => {
    const parsed = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=all")).json(),
    );
    expect(parsed.templates.find((t) => t.key === "swot")!.usageCount).toBe(2);
  });

  it("confirmed=false 是预检：返回真实的 stillBoundSegmentCount，且一个字节都不写", async () => {
    const res = await post("/templates/swot/archive", {
      key: "swot",
      version: 1,
      confirmed: false,
    });
    expect(res.status).toBe(200);
    const parsed = C.operations.archiveTemplate.out.parse(await res.json());
    expect(parsed.stillBoundSegmentCount).toBe(2);
    // ⚠ The precheck's whole point: the row is untouched.
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "published" });
  });

  it("confirmed=true：置位为 archived 且记住来处，行仍在，绑定仍然解析得到它", async () => {
    const res = await post("/templates/swot/archive", {
      key: "swot",
      version: 1,
      confirmed: true,
    });
    expect(res.status).toBe(200);
    expect(C.operations.archiveTemplate.out.parse(await res.json())).toEqual({
      status: "archived",
      stillBoundSegmentCount: 2,
    });
    expect(await readTemplate("swot", 1)).toMatchObject({
      status: "archived",
      archived_from: "published",
    });

    // O-10 的整条理由：现场切到这个议程环节时，存量绑定必须仍能连回模板行。
    // 归档若被实现成删除或过滤，这条 JOIN 会返回 0 行。
    const resolvable = await asApp(ORG, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM canvas_template_bindings b
           JOIN canvas_templates t
             ON t.org_id = b.org_id AND t.key = b.template_key AND t.version = b.template_version
          WHERE b.org_id = $1 AND b.template_key = 'swot'`,
        [ORG],
      );
      return Number(r.rows[0]!.n);
    });
    expect(resolvable).toBe(2);
  });

  it("归档后不出现在 forBinding 选择器里，但仍在 filter=archived 里（同一个端口，两种视图）", async () => {
    await post("/templates/swot/archive", { key: "swot", version: 1, confirmed: true });
    const binding = C.operations.listTemplates.out.parse(
      await (await listTemplates("forBinding=true")).json(),
    );
    expect(binding.templates).toEqual([]);
    const archived = C.operations.listTemplates.out.parse(
      await (await listTemplates("filter=archived")).json(),
    );
    expect(archived.templates.map((t) => t.key)).toEqual(["swot"]);
  });

  it("内置模板不可归档：403 BUILTIN_TEMPLATE_UNDELETABLE，库里没动", async () => {
    await seedTemplate({ key: "persona", version: 1, status: "published", builtin: true });
    const res = await post("/templates/persona/archive", {
      key: "persona",
      version: 1,
      confirmed: true,
    });
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("BUILTIN_TEMPLATE_UNDELETABLE");
    expect(await readTemplate("persona", 1)).toMatchObject({ status: "published" });
  });

  it("普通成员归档：403 ROLE_INSUFFICIENT，库里没动", async () => {
    const res = await post(
      "/templates/swot/archive",
      { key: "swot", version: 1, confirmed: true },
      MEMBER,
    );
    expect(res.status).toBe(403);
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "published" });
  });
});

describe("#463 · restoreTemplate：回到当初被归档时的那个状态", () => {
  it("archived(from published) → published", async () => {
    await seedTemplate({
      key: "swot",
      version: 1,
      status: "archived",
      archivedFrom: "published",
    });
    const res = await post("/templates/swot/restore", { key: "swot", version: 1 });
    expect(res.status).toBe(200);
    expect(C.operations.restoreTemplate.out.parse(await res.json())).toEqual({
      status: "published",
    });
    expect(await readTemplate("swot", 1)).toMatchObject({
      status: "published",
      archived_from: null,
    });
  });

  it("archived(from draft) → draft", async () => {
    await seedTemplate({ key: "jtbd", version: 1, status: "archived", archivedFrom: "draft" });
    const res = await post("/templates/jtbd/restore", { key: "jtbd", version: 1 });
    expect(C.operations.restoreTemplate.out.parse(await res.json())).toEqual({ status: "draft" });
    expect(await readTemplate("jtbd", 1)).toMatchObject({ status: "draft" });
  });

  it("archived(from trial) → draft（契约的 out 只有 draft|published 两个落点）", async () => {
    await seedTemplate({ key: "mvp", version: 1, status: "archived", archivedFrom: "trial" });
    const res = await post("/templates/mvp/restore", { key: "mvp", version: 1 });
    expect(C.operations.restoreTemplate.out.parse(await res.json())).toEqual({ status: "draft" });
  });

  it("恢复一个没归档的模板是非法转移：400，库里没动", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "published" });
    const res = await post("/templates/swot/restore", { key: "swot", version: 1 });
    expect(res.status).toBe(400);
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "published" });
  });

  /**
   * 反证：恢复到 published 时，如果实现忘了先归档同 key 的现任 published，
   * 数据库的部分唯一索引会拒绝这次恢复 —— 这条断言钉死的是「拒绝」而不是「静默覆盖」。
   */
  it("反证：同 key 已有 published 时恢复另一版，不会静默产生第二个 published", async () => {
    await seedTemplate({ key: "swot", version: 1, status: "archived", archivedFrom: "published" });
    await seedTemplate({ key: "swot", version: 2, status: "published" });
    const res = await post("/templates/swot/restore", { key: "swot", version: 1 });
    expect(res.status).toBe(409);
    expect(await readTemplate("swot", 1)).toMatchObject({ status: "archived" });
    expect(await readTemplate("swot", 2)).toMatchObject({ status: "published" });
  });
});
