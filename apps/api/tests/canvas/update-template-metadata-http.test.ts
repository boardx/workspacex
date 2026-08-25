/**
 * 2026-08-25（R2）—— `POST /canvas/templates/:key/:version/metadata`：原地改写
 * `displayName`/`tags`，**任意状态均可**，端到端。**待人类补签**（同 #496/#988/
 * `updateTemplateDraft` 的先例，见契约操作文件头）。
 *
 * ## 核心断言：改元数据 ≠ 改内容
 *
 * 与 `update-template-draft-http.test.ts` 恰好互补——那个文件证明「已发布版本的
 * **内容**改不动」，本文件证明「已发布版本的**名字/标签**改得动，且 `sections`
 * 一个字节都不变」。两条断言合起来才说清楚这条不变量真正管的是什么：
 * `sections` 不可变，元数据可变。只有前者会让 `updateTemplateMetadata` 看起来
 * 像是在推翻不变量，而 `sections` 压根不在这条路由的入参里。
 *
 * 走真 HTTP → controller → application → repository → PostgreSQL，持久面用 `asApp`
 * 重新读一遍，不信响应体——同既有纪律。
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canvas as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-r2-update-metadata";
const ADMIN = "u-r2-meta-admin";
const MEMBER = "u-r2-meta-member";

let BASE: string;
let app: NestExpressApplication;

const authFor = (userId: string, orgId = ORG) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

const SECTIONS = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

interface StoredTemplate {
  key: string;
  version: number;
  display_name: string;
  status: string;
  visibility: string;
  sections: unknown;
  tags: string[];
}

async function readRow(key: string, version: number): Promise<StoredTemplate | undefined> {
  return asApp(ORG, async (c) => {
    const r = await c.query<StoredTemplate>(
      `SELECT key, version, display_name, status, visibility, sections, tags
         FROM canvas_templates WHERE org_id = $1 AND key = $2 AND version = $3`,
      [ORG, key, version],
    );
    return r.rows[0];
  });
}

async function seedTemplate(t: {
  key: string; version: number; status: "draft" | "published" | "archived"; tags?: string[];
}): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO canvas_templates
         (org_id, key, version, display_name, status, archived_from, builtin, visibility,
          underlying_type, sections, tags)
       VALUES ($1,$2,$3,$4,$5,$6,false,'org-wide','canvas',$7::jsonb,$8::text[])`,
      [ORG, t.key, t.version, `${t.key} 原名`, t.status,
        t.status === "archived" ? "published" : null, JSON.stringify(SECTIONS), t.tags ?? []],
    ),
  );
}

const updateMetadata = (body: { key: string; version: number } & Record<string, unknown>, userId = ADMIN) =>
  fetch(`${BASE}/canvas/templates/${body.key}/${body.version}/metadata`, {
    method: "POST",
    headers: authFor(userId),
    body: JSON.stringify(body),
  });

function metaBody(over: Record<string, unknown> = {}): { key: string; version: number } & Record<string, unknown> {
  return {
    key: "tpl-draft",
    version: 1,
    displayName: "改过的名字",
    tags: ["用户研究", "同理心"],
    ...over,
  } as { key: string; version: number } & Record<string, unknown>;
}

async function reasonCodeOf(res: Response): Promise<unknown> {
  return (await res.json() as { reasonCode?: unknown }).reasonCode;
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
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-workshop` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy ?? null);
  await addOrgMember(ORG, MEMBER, "consultant", fixture.teams.energy ?? null);
  await seedTemplate({ key: "tpl-draft", version: 1, status: "draft" });
  await seedTemplate({ key: "tpl-published", version: 1, status: "published", tags: ["旧标签"] });
  await seedTemplate({ key: "tpl-archived", version: 1, status: "archived" });
});

describe("2026-08-25 R2 · POST /canvas/templates/:key/:version/metadata", () => {
  it("① draft：改名 + 换标签，库里真的变了，sections 一个字节没动", async () => {
    const before = await readRow("tpl-draft", 1);
    const res = await updateMetadata(metaBody());
    expect(res.status).toBe(200);

    const parsed = C.operations.updateTemplateMetadata.out.parse(await res.json());
    expect(parsed).toEqual({
      key: "tpl-draft",
      version: 1,
      status: "draft",
      displayName: "改过的名字",
      builtin: false,
      visibility: "org-wide",
      underlyingType: "canvas",
      tags: ["用户研究", "同理心"],
    });

    const after = await readRow("tpl-draft", 1);
    expect(after?.display_name).toBe("改过的名字");
    expect(after?.tags).toEqual(["用户研究", "同理心"]);
    // 这是本文件的核心断言：元数据改了，内容原样。
    expect(after?.sections).toEqual(before?.sections);
    expect(after?.status).toBe("draft");
  });

  it("② 已发布版本：名字/标签**改得动**（与 updateTemplateDraft 恰好相反），sections 仍不变", async () => {
    const before = await readRow("tpl-published", 1);
    const res = await updateMetadata(metaBody({ key: "tpl-published", displayName: "线上模板新名字", tags: ["线上"] }));
    expect(res.status).toBe(200);

    const after = await readRow("tpl-published", 1);
    expect(after?.display_name).toBe("线上模板新名字");
    expect(after?.tags).toEqual(["线上"]);
    expect(after?.sections).toEqual(before?.sections);
    // 状态不受影响——改名不是一次状态转移。
    expect(after?.status).toBe("published");
  });

  it("② 已归档版本：同样改得动，且不会把它复活成别的状态", async () => {
    const res = await updateMetadata(metaBody({ key: "tpl-archived", displayName: "归档件改名" }));
    expect(res.status).toBe(200);
    const after = await readRow("tpl-archived", 1);
    expect(after?.display_name).toBe("归档件改名");
    expect(after?.status).toBe("archived");
  });

  it("③ tags 省略 ⇒ 归一成空数组（清空标签），不是「保持原样」", async () => {
    const res = await updateMetadata({ key: "tpl-published", version: 1, displayName: "只改名字" });
    expect(res.status).toBe(200);
    const after = await readRow("tpl-published", 1);
    // 全量替换语义（同 updateTemplateDraft 的 sections）：不传 = 传空数组 = 清空。
    expect(after?.tags).toEqual([]);
  });

  it("④ key/version 不存在 ⇒ 404 TEMPLATE_NOT_FOUND", async () => {
    const res = await updateMetadata(metaBody({ key: "no-such-key" }));
    expect(res.status).toBe(404);
    expect(await reasonCodeOf(res)).toBe("TEMPLATE_NOT_FOUND");
  });

  it("⑤ 非管理员被拒（ROLE_INSUFFICIENT），且什么都不变", async () => {
    const before = await readRow("tpl-draft", 1);
    const res = await updateMetadata(metaBody(), MEMBER);
    expect(res.status).toBe(403);
    expect(await reasonCodeOf(res)).toBe("ROLE_INSUFFICIENT");
    expect(await readRow("tpl-draft", 1)).toEqual(before);
  });

  it("⑥ 路径 key 与 body key 打架 ⇒ 400；路径 version 与 body version 打架 ⇒ 也 400", async () => {
    const keyMismatch = await fetch(`${BASE}/canvas/templates/other-key/1/metadata`, {
      method: "POST", headers: authFor(ADMIN), body: JSON.stringify(metaBody()),
    });
    expect(keyMismatch.status).toBe(400);

    const versionMismatch = await fetch(`${BASE}/canvas/templates/tpl-draft/99/metadata`, {
      method: "POST", headers: authFor(ADMIN), body: JSON.stringify(metaBody()),
    });
    expect(versionMismatch.status).toBe(400);
  });

  it("⑦ 刷新后仍在——listTemplates 读回来的就是新名字与新标签", async () => {
    await updateMetadata(metaBody());
    const out = await C.operations.listTemplates.out.parseAsync(
      await fetch(`${BASE}/canvas/templates?orgId=${ORG}&filter=all`, { headers: authFor(ADMIN) })
        .then((r) => r.json()),
    );
    const row = out.templates.find((t) => t.key === "tpl-draft" && t.version === 1);
    expect(row?.displayName).toBe("改过的名字");
    expect(row?.tags).toEqual(["用户研究", "同理心"]);
  });
});
