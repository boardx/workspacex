/**
 * 2026-08-23 —— `POST /canvas/templates/:key/draft`：原地改写一个仍是 `draft` 的版本，
 * 端到端。**待人类补签**（同 #496/#988 的先例，见契约操作文件头）。
 *
 * ## 核心断言：这条不变量原样保留
 *
 * `template-ports.ts` 文件头逐字写着「已发布/已归档版本永远是不可变快照」——本文件
 * 最重要的一条测试是「已发布/已归档版本调这条路由，恒被拒（`TEMPLATE_NOT_DRAFT`），
 * 内容一个字节都不变」。收窄的只是"草稿在发布前是否可变"这一半。
 *
 * 走真 HTTP → controller → application → repository → PostgreSQL，持久面用 `asApp`
 * 重新读一遍，不信响应体——同 `create-template-http.test.ts` 的既有纪律。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-1854-update-draft";
const OTHER_ORG = "org-1854-update-draft-other";
const ADMIN = "u-1854-admin";
const MEMBER = "u-1854-member";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

const SECTIONS_A = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
];
const SECTIONS_B = [
  { sectionId: "s1", name: "机会", order: 0, required: false, capacity: 3 },
  { sectionId: "s2", name: "威胁", order: 1, required: false, capacity: null },
];

interface StoredTemplate {
  key: string;
  version: number;
  display_name: string;
  status: string;
  visibility: string;
  sections: unknown;
}

async function readRow(key: string, version: number, orgId = ORG): Promise<StoredTemplate | undefined> {
  return asApp(orgId, async (c) => {
    const r = await c.query<StoredTemplate>(
      `SELECT key, version, display_name, status, visibility, sections
         FROM canvas_templates WHERE org_id = $1 AND key = $2 AND version = $3`,
      [orgId, key, version],
    );
    return r.rows[0];
  });
}

async function seedTemplate(t: {
  key: string; version: number; status: "draft" | "published" | "archived"; orgId?: string;
}): Promise<void> {
  const orgId = t.orgId ?? ORG;
  await asApp(orgId, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections)
       VALUES ($1,$2,$3,$4,$5,$6,false,'org-wide','canvas',$7::jsonb)`,
      [orgId, t.key, t.version, `${t.key} v${t.version}`, t.status,
        t.status === "archived" ? "published" : null, JSON.stringify(SECTIONS_A)],
    ),
  );
}

const updateDraft = (body: unknown, userId = ADMIN, orgId = ORG) =>
  fetch(`${BASE}${C.operations.updateTemplateDraft.path.replace(":key", (body as { key: string }).key)}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });

function draftBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "swot-draft",
    version: 1,
    displayName: "SWOT 草稿 v2 改过的名字",
    sections: SECTIONS_B,
    visibility: "org-wide",
    ...over,
  };
}

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
}

let adminTeamId: string | null = null;

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
  await seedOrg({ orgId: OTHER_ORG, projectId: `${OTHER_ORG}-workshop` });
  adminTeamId = fixture.teams.energy ?? null;
  await addOrgMember(ORG, ADMIN, "admin", adminTeamId);
  await addOrgMember(ORG, MEMBER, "consultant", adminTeamId);
  await seedTemplate({ key: "swot-draft", version: 1, status: "draft" });
  await seedTemplate({ key: "swot-published", version: 1, status: "published" });
  await seedTemplate({ key: "swot-archived", version: 1, status: "archived" });
});

describe("2026-08-23 · POST /canvas/templates/:key/draft", () => {
  it("① 仍是 draft：全量替换 displayName/sections/visibility，库里真的变了", async () => {
    const res = await updateDraft(draftBody());
    expect(res.status).toBe(200);

    const parsed = C.operations.updateTemplateDraft.out.parse(await res.json());
    expect(parsed).toEqual({
      key: "swot-draft",
      version: 1,
      status: "draft",
      displayName: "SWOT 草稿 v2 改过的名字",
      builtin: false,
      visibility: "org-wide",
      underlyingType: "canvas",
      sections: SECTIONS_B,
      tags: [],
    });

    // 持久面重新读一遍——响应体可以只是把入参回显了一遍。
    const row = await readRow("swot-draft", 1);
    expect(row?.display_name).toBe("SWOT 草稿 v2 改过的名字");
    expect(row?.sections).toEqual(SECTIONS_B);
    expect(row?.status).toBe("draft");
  });

  it("② 已发布版本 ⇒ 409 TEMPLATE_NOT_DRAFT，内容一个字节都不变——不变量原样保留", async () => {
    const before = await readRow("swot-published", 1);
    const res = await updateDraft(draftBody({ key: "swot-published" }));
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_DRAFT");

    const after = await readRow("swot-published", 1);
    expect(after).toEqual(before);
  });

  it("② 已归档版本 ⇒ 同样 409 TEMPLATE_NOT_DRAFT，内容不变", async () => {
    const before = await readRow("swot-archived", 1);
    const res = await updateDraft(draftBody({ key: "swot-archived" }));
    expect(res.status).toBe(409);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_DRAFT");
    expect(await readRow("swot-archived", 1)).toEqual(before);
  });

  it("③ key/version 都不存在 ⇒ 404 TEMPLATE_NOT_FOUND", async () => {
    const res = await updateDraft(draftBody({ key: "no-such-key" }));
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
  });

  it("④ 非管理员被拒（ROLE_INSUFFICIENT），且内容不变——与 createTemplate 同一判定函数", async () => {
    const before = await readRow("swot-draft", 1);
    const res = await updateDraft(draftBody(), MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readRow("swot-draft", 1)).toEqual(before);
  });

  it("⑤ 路径 key 与请求体 key 打架 ⇒ 400，不静默挑一个", async () => {
    const res = await fetch(`${BASE}/canvas/templates/some-other-key/draft`, {
      method: "POST",
      headers: authFor(ADMIN),
      body: JSON.stringify(draftBody()),
    });
    expect(res.status).toBe(400);
  });

  it("⑥ 刷新后仍在——真的写进了库，不是一次响应体回显", async () => {
    await updateDraft(draftBody());
    const out = await C.operations.listTemplates.out.parseAsync(
      await fetch(`${BASE}/canvas/templates?orgId=${ORG}&filter=draft`, { headers: authFor(ADMIN) })
        .then((r) => r.json()),
    );
    const row = out.templates.find((t) => t.key === "swot-draft" && t.version === 1);
    expect(row?.displayName).toBe("SWOT 草稿 v2 改过的名字");
    expect(row?.sections).toEqual(SECTIONS_B);
  });
});
