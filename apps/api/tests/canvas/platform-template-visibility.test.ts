/**
 * B2 全局模板：**母版对所有组织可见、只读；用时 fork 出组织自己的一份。**
 *
 * 人类 2026-08-26 裁决「新建的模板是给所有的组织使用的，并不是给某一个组织使用」，
 * 并在 B1（库里一份大家共享）与 B2（全局母版 + 用时 fork）之间选定 B2。
 *
 * ## 这份测试要证的四件事，逐条都是「不这么做就出事」
 *
 * 1. **别的组织真的看得见母版** —— 否则「给所有组织使用」就没兑现。
 * 2. **别的组织改不动母版** —— 只读是 RLS 策略层面的事实（`canvas_templates_platform_read`
 *    只放 SELECT），不是前端的一句 if。这一条直接对着库验，不经过任何 UI。
 * 3. **fork 之后是组织自有行** —— `platform: false`，且它出现在自己的库里。
 *    这是 B2 相对 B1 的**全部价值**：绑定永远指向组织自有行，
 *    `canvas_template_bindings` 那条含 `org_id` 的复合外键一个字都不用改。
 * 4. **A 组织 fork 不影响 B 组织** —— 否则就退化成了共享，AC2（组织隔离）被破。
 *
 * ⚠ 真库真栈，不是 mock：本条要证的恰恰是 **RLS 策略**与**外键**的行为，
 *   而那两样东西在 mock 里根本不存在。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { asOwner, resetOrgs, seedOrg, addOrgMember, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgCanvasTemplateRepository } from "../../src/infrastructure/canvas/pg-canvas-template-repository";
import { createTemplate } from "../../src/application/canvas/create-template";
import { publishTemplate } from "../../src/application/canvas/publish-template";
import { listTemplates } from "../../src/application/canvas/list-templates";
import { adoptTemplate } from "../../src/application/canvas/adopt-template";
import { CanvasError } from "../../src/application/canvas/errors";
import { PLATFORM_ORG_ID } from "../../src/domain/canvas/platform-org";
import { toOrgId } from "../../src/domain/org-id";

const ORG_A = "org-platform-vis-a";
const ORG_B = "org-platform-vis-b";
const ADMIN_A = "u-platform-vis-a";
const ADMIN_B = "u-platform-vis-b";
const SVC = "svc-platform-templates";
const KEY = "persona";

let db: PgDatabase;
let deps: {
  identity: PgIdentityRepository;
  templates: PgCanvasTemplateRepository;
  ids: { next: () => string };
};

const SECTIONS = [
  {
    sectionId: "s1", name: "用户描述", order: 0, required: false, capacity: null,
    key: "description", type: "便利贴列表" as const, aiHint: null,
    layout: { col: 1, row: 1, w: 4, h: 4, cols: 3, max: 6, tone: 0, overflow: "缩小字号" as const },
  },
];

beforeAll(async () => {
  // ⚠ 迁移由各测试自己重放（见 `vitest.config.ts` 那段注释）——漏掉这一步的表现是
  //   `relation "organizations" does not exist`，读起来像"库坏了"，实际是没建。
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    identity: new PgIdentityRepository(db),
    templates: new PgCanvasTemplateRepository(db),
    ids: { next: () => "d-platform-vis" },
  };
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG_A, ORG_B);
  await asOwner((c) => c.query(`DELETE FROM canvas_templates WHERE org_id = $1`, [PLATFORM_ORG_ID]));
});

beforeEach(async () => {
  await resetOrgs(ORG_A, ORG_B);
  await asOwner((c) => c.query(`DELETE FROM canvas_templates WHERE org_id = $1`, [PLATFORM_ORG_ID]));
  for (const [org, admin] of [[ORG_A, ADMIN_A], [ORG_B, ADMIN_B]] as const) {
    const fixture = await seedOrg({ orgId: org, projectId: `${org}-ws` });
    await addOrgMember(org, admin, "admin", fixture.teams.energy ?? null);
  }
  // 平台母版：走**真实用例**（create + publish），与回填脚本同一条路径。
  await createTemplate(deps, {
    userId: SVC, orgId: toOrgId(PLATFORM_ORG_ID), key: KEY,
    displayName: "用户画像", underlyingType: "canvas",
    sections: SECTIONS, visibility: "org-wide", tags: ["工作坊"],
  });
  await publishTemplate(deps, {
    userId: SVC, orgId: toOrgId(PLATFORM_ORG_ID), key: KEY, version: 1, visibility: "org-wide",
  });
});

describe("B2 平台模板母版", () => {
  it("① 两个互不相干的组织**都**看得见同一份母版", async () => {
    for (const [org, admin] of [[ORG_A, ADMIN_A], [ORG_B, ADMIN_B]] as const) {
      const { templates } = await listTemplates(deps, {
        userId: admin, orgId: toOrgId(org), filter: "all",
      });
      const master = templates.find((t) => t.key === KEY);
      expect(master, `org=${org} 应当看得见平台母版`).toBeDefined();
      expect(master!.platform).toBe(true);
      expect(master!.status).toBe("published");
    }
  });

  it("② 母版对组织**只读** —— 是 RLS 层面的事实，不是前端的一句 if", async () => {
    // 以 ORG_A 的租户上下文去改平台那一行：RLS 的 USING 只放 SELECT，
    // 写策略仍然严格按 app.current_org ⇒ 影响 0 行。
    const affected = await db.withTenant(toOrgId(ORG_A), async (s) => {
      const r = await s.query(
        `UPDATE canvas_templates SET display_name = '被别的组织改了'
          WHERE org_id = $1 AND key = $2`,
        [PLATFORM_ORG_ID, KEY],
      );
      return r.rowCount ?? 0;
    });
    expect(affected).toBe(0);

    // 反证：库里那一行确实没被改（只断言 rowCount 不够——0 行也可能是没匹配上）。
    const after = await asOwner((c) =>
      c.query<{ display_name: string }>(
        `SELECT display_name FROM canvas_templates WHERE org_id = $1 AND key = $2`,
        [PLATFORM_ORG_ID, KEY],
      ),
    );
    expect(after.rows[0]?.display_name).toBe("用户画像");
  });

  it("③ fork 之后是**组织自有行**：platform=false，且母版仍在", async () => {
    const adopted = await adoptTemplate(deps, {
      userId: ADMIN_A, orgId: toOrgId(ORG_A), key: KEY,
    });
    expect(adopted.platform).toBe(false);
    expect(adopted.status).toBe("published");

    const { templates } = await listTemplates(deps, {
      userId: ADMIN_A, orgId: toOrgId(ORG_A), filter: "all",
    });
    const rows = templates.filter((t) => t.key === KEY);
    // 同一个 key 现在有两行：母版（platform）+ 自有（非 platform）。
    expect(rows.map((t) => t.platform).sort()).toEqual([false, true]);

    // 自有那行真的落在 ORG_A 名下（不是"看起来是"）。
    const own = await asOwner((c) =>
      c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM canvas_templates WHERE org_id = $1 AND key = $2`,
        [ORG_A, KEY],
      ),
    );
    expect(own.rows[0]?.n).toBe("1");
  });

  it("④ A 组织 fork **不影响** B 组织 —— 否则就退化成共享，AC2 被破", async () => {
    await adoptTemplate(deps, { userId: ADMIN_A, orgId: toOrgId(ORG_A), key: KEY });

    const { templates } = await listTemplates(deps, {
      userId: ADMIN_B, orgId: toOrgId(ORG_B), filter: "all",
    });
    const rows = templates.filter((t) => t.key === KEY);
    // B 只看得见母版一行；A 的那份副本对 B 不可见。
    expect(rows.length).toBe(1);
    expect(rows[0]!.platform).toBe(true);
  });

  it("⑤ 重复 fork 抛 TEMPLATE_KEY_CONFLICT —— 幂等的正确形状，不是失败", async () => {
    await adoptTemplate(deps, { userId: ADMIN_A, orgId: toOrgId(ORG_A), key: KEY });
    await expect(
      adoptTemplate(deps, { userId: ADMIN_A, orgId: toOrgId(ORG_A), key: KEY }),
    ).rejects.toMatchObject({ reasonCode: "TEMPLATE_KEY_CONFLICT" });
  });

  it("⑥ 平台库里没有的 key ⇒ TEMPLATE_NOT_FOUND（不静默造一个空模板）", async () => {
    await expect(
      adoptTemplate(deps, { userId: ADMIN_A, orgId: toOrgId(ORG_A), key: "not-a-master" }),
    ).rejects.toBeInstanceOf(CanvasError);
  });
});
