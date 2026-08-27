/**
 * #2221 — `layout_source` 写入侧：谁在什么时候把它写成什么。
 *
 * 根因回顾：chat 里渲染 19 个内置 canvas 模板时，`fence-template-resolver.ts` 只要
 * `getTemplate(key)` 命中内置注册表就直接用包内原生几何，从不查组织的
 * `canvas_templates` 行——而 `backfill-canvas-builtin-templates.ts` 已经给每个开通过
 * 的组织把 19 个内置 key 的行都建好了，"DB 里有一行"对内置 key 恒真，不能拿它当
 * "用户真的改过"的判据。这份测试钉的是**写入侧**：`layout_source` 这一列在
 * 创建/编辑/backfill 三条路径里分别落什么值，以及"一旦 user-edited 不可退回"这条
 * 单调性——读侧（resolver 判据）的钉子在 `apps/web/tests/ui/chat-canvas-fence-layout-source.test.tsx`。
 *
 * 真库真栈：走真实用例（`createTemplate`/`mintTemplateVersion`/`updateTemplateDraft`）
 * + 真实仓储 SQL，不 mock 掉这一列的写入本身。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { asApp, resetOrgs, seedOrg, addOrgMember, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgCanvasTemplateRepository } from "../../src/infrastructure/canvas/pg-canvas-template-repository";
import { createTemplate } from "../../src/application/canvas/create-template";
import { mintTemplateVersion } from "../../src/application/canvas/mint-template-version";
import { updateTemplateDraft } from "../../src/application/canvas/update-template-draft";
import { publishTemplate } from "../../src/application/canvas/publish-template";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-2221-layout-source";
const ADMIN = "u-2221-admin";

let db: PgDatabase;
let deps: {
  identity: PgIdentityRepository;
  templates: PgCanvasTemplateRepository;
};

const SECTIONS = [
  { sectionId: "s1", name: "分区一", order: 0, required: true, capacity: null },
];

async function layoutSourceOf(key: string, version: number): Promise<string | null> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ layout_source: string }>(
      `SELECT layout_source FROM canvas_templates WHERE org_id = $1 AND key = $2 AND version = $3`,
      [ORG, key, version],
    );
    return r.rows[0]?.layout_source ?? null;
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    identity: new PgIdentityRepository(db),
    templates: new PgCanvasTemplateRepository(db),
  };
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fixture = await seedOrg({ orgId: ORG, projectId: `${ORG}-ws` });
  await addOrgMember(ORG, ADMIN, "admin", fixture.teams.energy ?? null);
});

describe("#2221 · createTemplate 恒写 builtin-derived", () => {
  it("新建的行 layout_source = 'builtin-derived'（服务端写死，创建这一刻还没有内容可言）", async () => {
    const out = await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-a",
      displayName: "复盘", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    expect(out.layoutSource).toBe("builtin-derived");
    expect(await layoutSourceOf("retro-2221-a", 1)).toBe("builtin-derived");
  });
});

describe("#2221 · 真实编辑器路径（无 backfill 标记）恒写 user-edited", () => {
  it("mintTemplateVersion 不带 fromBackfill（真实 HTTP 会走这条）→ user-edited", async () => {
    await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-b",
      displayName: "复盘", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    const minted = await mintTemplateVersion(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-b",
      displayName: "复盘 v2", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    expect(minted.layoutSource).toBe("user-edited");
    expect(await layoutSourceOf("retro-2221-b", minted.version)).toBe("user-edited");
  });

  it("updateTemplateDraft（编辑器保存草稿分区）恒写 user-edited", async () => {
    const created = await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-c",
      displayName: "复盘", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    expect(created.layoutSource).toBe("builtin-derived");
    const updated = await updateTemplateDraft(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-c", version: created.version,
      displayName: "复盘（改过）", sections: SECTIONS, visibility: "org-wide",
    });
    expect(updated.layoutSource).toBe("user-edited");
    expect(await layoutSourceOf("retro-2221-c", created.version)).toBe("user-edited");
  });
});

describe("#2221 · 实际跑一次 backfill-canvas-builtin-templates.ts 脚本本身", () => {
  it("真实脚本创建的行 layout_source 全部是 builtin-derived（走的是与用户编辑同名的用例，" +
    "靠内部标记而不是靠『谁调用的』区分）", async () => {
    const { backfillCanvasBuiltinTemplates } = await import("../../scripts/backfill-canvas-builtin-templates");
    await backfillCanvasBuiltinTemplates(ORG);
    expect(await layoutSourceOf("persona", 1)).toBe("builtin-derived");
    expect(await layoutSourceOf("swot", 1)).toBe("builtin-derived");
  });
});

describe("#2221 · backfill 内部标记写 builtin-derived", () => {
  it("mintTemplateVersion({ fromBackfill: true }) 在从未被标过 user-edited 的 key 上 → builtin-derived", async () => {
    await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-d",
      displayName: "复盘", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    const minted = await mintTemplateVersion(
      deps,
      {
        userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-d",
        displayName: "复盘（backfill 补齐配置）", underlyingType: "canvas",
        sections: SECTIONS, visibility: "org-wide",
      },
      { fromBackfill: true },
    );
    expect(minted.layoutSource).toBe("builtin-derived");
    expect(await layoutSourceOf("retro-2221-d", minted.version)).toBe("builtin-derived");
  });
});

describe("#2221 · 一旦 user-edited 不可退回（单调性）", () => {
  it("真人编辑过之后，backfill 再铸一版（哪怕内容与默认值字节相同）也不会把它标回 builtin-derived", async () => {
    await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "persona-sticky",
      displayName: "用户画像", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    // 真人在编辑器里改过一版——layout_source 落 user-edited。
    const edited = await mintTemplateVersion(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "persona-sticky",
      displayName: "用户画像（真人改过）", underlyingType: "canvas",
      sections: SECTIONS, visibility: "org-wide",
    });
    expect(edited.layoutSource).toBe("user-edited");

    // backfill 重跑「补齐配置」，内容原样传回（模拟契约里说的"哪怕内容与默认值字节
    // 相同"）——不能因为这次调用带了 fromBackfill:true 就把已经被标过的 key 打回默认值。
    const reBackfilled = await mintTemplateVersion(
      deps,
      {
        userId: ADMIN, orgId: toOrgId(ORG), key: "persona-sticky",
        displayName: "用户画像（真人改过）", underlyingType: "canvas",
        sections: SECTIONS, visibility: "org-wide",
      },
      { fromBackfill: true },
    );
    expect(reBackfilled.layoutSource).toBe("user-edited");
    expect(await layoutSourceOf("persona-sticky", reBackfilled.version)).toBe("user-edited");
  });
});

describe("#2221 · listTemplates.out 逐字带 layoutSource（chat resolver 读的就是这一栏）", () => {
  it("已发布的行，HTTP 响应体里的 layoutSource 与库里一致", async () => {
    const created = await createTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-e",
      displayName: "复盘", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    const minted = await mintTemplateVersion(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-e",
      displayName: "复盘 v2", underlyingType: "canvas", sections: SECTIONS, visibility: "org-wide",
    });
    await publishTemplate(deps, {
      userId: ADMIN, orgId: toOrgId(ORG), key: "retro-2221-e", version: minted.version, visibility: "org-wide",
    });
    const { listTemplates } = await import("../../src/application/canvas/list-templates");
    const { templates } = await listTemplates(
      { ...deps, ids: { next: () => "d-2221" } },
      { userId: ADMIN, orgId: toOrgId(ORG), filter: "all" },
    );
    const row = templates.find((t) => t.key === "retro-2221-e" && t.version === minted.version);
    expect(row?.layoutSource).toBe("user-edited");
    const oldRow = templates.find((t) => t.key === "retro-2221-e" && t.version === created.version);
    expect(oldRow?.layoutSource).toBe("builtin-derived");
  });
});
