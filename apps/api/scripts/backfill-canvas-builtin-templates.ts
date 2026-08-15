/**
 * 一次性（幂等，可安全重跑）backfill：把 `@repo/fabric-markdown` 的 19 个内置《工作坊模板
 * A0》加载进某一个**已存在、人类明确要求**的组织的真实画布模板库。
 *
 * 人类 2026-08-15 原话（对着后台真实截图，`/admin/canvasadmin`「画布模板」，组织
 * org-2e5de17f74b8731f / boardx，当时只有一条真实模板"ABC"）：「需要加载初始化的19个模板」。
 *
 * ## 为什么**不是**「所有组织」的 backfill（跟 `backfill-default-agents.ts` 刻意不同）
 *
 * `apps/api/migrations/20260805030000_canvas_template_registry.sql` 文件头刻意零 seed，
 * 理由是 F15 验收 V1 硬性要求「一个没配置过的组织，模板库必须是空的」。`lint-no-builtin-
 * capabilities.mjs` 不拦这条真实 API 路径（它只扫源码静态列表字面量与
 * `capability_listings` 的 migration INSERT），但**语义上**把这个 backfill 无差别地跑给
 * 「所有组织」、还像 `backfill-default-agents.ts` 那样 wire 进 `deploy.sh`，就会让每个未来
 * 新建的空组织在下一次 deploy 时被动获得 19 条内置模板——那正是 V1 想挡住的事：一个人类
 * 从未点过「新建模板」的组织，模板库却不是空的。
 *
 * 所以本脚本**必须显式传入一个组织 id**（第一个 CLI 参数），只对那一个组织生效，且
 * **不 wire 进 `deploy.sh`**——它是「某个真人管理员明确要求把内置模板加进他的组织」的
 * 一次性等价物，不是「每次部署都自愈」的结构性 seed。
 *
 * ## 走的是真实 create/publish 用例，不是裸 INSERT
 *
 * 跟 `backfill-default-agents.ts` 同一条纪律：实际写入走 `PgDatabase` + 真实 application
 * 用例（`createTemplate`/`publishTemplate`），逐条模拟「管理员在后台点了一次新建、点了一次
 * 发布」——与生产流量完全同一条路径，不会跟真实写路径漂移。鉴权（`requireTemplateAdmin`
 * = org admin）、`TEMPLATE_KEY_CONFLICT` 幂等判定、发布前置校验，全部照走一遍。
 *
 * ## sections 字段映射（唯一的转换缺口）
 *
 * fabric-markdown `TemplateSpec.sections`（`{name,x,y,w,h,fill?}`，几何布局）与契约
 * `SectionDef`（`{sectionId,name,order,required,capacity}`，纯元数据）只共享 `name` 一个
 * 字段——这与 `template-admin.tsx` 表单现有的手工新建路径完全一致（照抄它的写法），
 * 几何/装饰信息继续留在 fabric-markdown 里，靠同一个 `key` 关联，不在这条表里落地。
 *
 * ## displayName 的权威
 *
 * 唯一来源是 `packages/contracts/src/canvas.ts` 的 `BUILTIN_CANVAS_TEMPLATES`（O-09 单点
 * 事实源）——不读 fabric-markdown 的 `TemplateSpec.title`（那是画布内标题，中英双语，不是
 * 后台列表要的 displayName，两者是不同的展示层事实）。
 *
 * 用法：`pnpm --filter api exec tsx scripts/backfill-canvas-builtin-templates.ts <orgId>`
 */
import { migrationConfig, appConfig } from "../src/infrastructure/db/pg-config";
import { PgDatabase } from "../src/infrastructure/db/pg-database";
import { PgIdentityRepository } from "../src/infrastructure/identity/pg-identity-repository";
import { PgCanvasTemplateRepository } from "../src/infrastructure/canvas/pg-canvas-template-repository";
import { createTemplate } from "../src/application/canvas/create-template";
import { publishTemplate } from "../src/application/canvas/publish-template";
import { CanvasError } from "../src/application/canvas/errors";
import { toOrgId } from "../src/domain/org-id";
import { listTemplates } from "@repo/fabric-markdown/templates";
import { canvas } from "@repo/contracts";
import pg from "pg";

export interface CanvasTemplateBackfillReport {
  readonly orgId: string;
  readonly actorId: string;
  readonly total: number;
  readonly created: number;
  readonly alreadyExisted: number;
  readonly published: number;
}

/**
 * 导出成函数（不是裸顶层 `await`），供测试直接调用同一份逻辑，不重实现第二份 SQL/编排。
 */
export async function backfillCanvasBuiltinTemplates(orgId: string): Promise<CanvasTemplateBackfillReport> {
  // 找这个组织最早的 admin 作为 actor —— 与 `backfill-default-agents.ts` 同一个理由：
  // 跨租户读（谁是这个组织的 admin）RLS 对 app 角色故意封，只有 OWNER 连接能读。
  const owner = new pg.Pool({ ...migrationConfig(), max: 2 });
  let actorId: string;
  try {
    const { rows } = await owner.query<{ user_id: string }>(
      `SELECT user_id FROM org_memberships
        WHERE org_id = $1 AND org_role = 'admin'
        ORDER BY user_id ASC LIMIT 1`,
      [orgId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        `[backfill-canvas-builtin-templates] org=${orgId} 没有任何 admin 成员，` +
        `无法确定 actor（画布模板写权限只放行 org admin）——先确认这个组织已经有一个 admin。`,
      );
    }
    actorId = row.user_id;
  } finally {
    await owner.end();
  }

  const db = new PgDatabase(appConfig());
  try {
    const identity = new PgIdentityRepository(db);
    const templates = new PgCanvasTemplateRepository(db);
    const org = toOrgId(orgId);

    const specs = listTemplates();
    let created = 0;
    let published = 0;

    for (const spec of specs) {
      const displayName = (canvas.BUILTIN_CANVAS_TEMPLATES as Record<string, string>)[spec.key];
      if (displayName === undefined) {
        // 契约 I-36 断言已经把 fabric-markdown 的 19 个 key 与 BUILTIN_CANVAS_TEMPLATES
        // 的键集合绑死相等（见 `tests/canvas/template-registry-19-key-displayname.test.ts`）；
        // 这里不该发生，发生了就是那条断言本身失效——如实抛出，不静默跳过。
        throw new Error(
          `[backfill-canvas-builtin-templates] fabric-markdown key "${spec.key}" 不在 ` +
          `BUILTIN_CANVAS_TEMPLATES 里——契约 I-36 的集合相等断言应该已经挡住这种情况，` +
          `如果真的走到这里，先查那条测试是不是被绕过了。`,
        );
      }

      // template-admin.tsx 表单现有的写法：只取 name，容量/是否必填如实留白（D-a 待定项）。
      const sections = spec.sections.map((s, i) => ({
        sectionId: `s${i + 1}`,
        name: s.name,
        order: i,
        required: false,
        capacity: null,
      }));

      let outcome;
      try {
        outcome = await createTemplate(
          { identity, templates },
          {
            userId: actorId,
            orgId: org,
            key: spec.key,
            displayName,
            underlyingType: "canvas",
            sections,
            visibility: "org-wide",
          },
        );
        created += 1;
        console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} created (v${outcome.version})`);
      } catch (e) {
        if (e instanceof CanvasError && e.reasonCode === "TEMPLATE_KEY_CONFLICT") {
          console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} 已存在，跳过（幂等）`);
          continue;
        }
        throw e;
      }

      await publishTemplate(
        { identity, templates },
        { userId: actorId, orgId: org, key: spec.key, version: outcome.version, visibility: "org-wide" },
      );
      published += 1;
      console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} published`);
    }

    const alreadyExisted = specs.length - created;
    console.log(
      `[backfill-canvas-builtin-templates] 完成：org=${orgId} 共 ${specs.length} 个内置模板，` +
      `新建 ${created} 个（其中发布 ${published} 个），已存在跳过 ${alreadyExisted} 个。`,
    );
    return { orgId, actorId, total: specs.length, created, alreadyExisted, published };
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error(
      "用法：pnpm --filter api exec tsx scripts/backfill-canvas-builtin-templates.ts <orgId>\n" +
      "⚠ 必须显式传组织 id——本脚本刻意不支持「所有组织」，见文件头「为什么不是所有组织」一节。",
    );
    process.exit(1);
  }
  await backfillCanvasBuiltinTemplates(orgId);
}
