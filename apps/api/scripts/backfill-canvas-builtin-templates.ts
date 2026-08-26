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
 * ## sections 字段映射：**这条缺口已于 2026-08-26 补上**
 *
 * 原先这里写着「几何/装饰信息继续留在 fabric-markdown 里，不在这条表里落地」——于是
 * 库里那 19 条内置模板的每个分区**只有一个 `name`**。后果不是"少存了点装饰"：新版模板
 * 编辑器（`Design.pdf` 的 12×8 拖拽画布）能编的就是 `key` / `type` / `layout` 这三样，
 * 一样不落地 ⇒ 人类打开「用户画像」看到的是一张空表，**什么都改不了**。人类 2026-08-26
 * 原话：「所有的不同阶段的数据都可以查看和修改」。
 *
 * 补法是**推演**，不是发明：`domain/canvas/builtin-template-config.ts` 把 spec 的 px 中心点
 * 机械换算成 12×8 网格坐标（两条边各自吸附，见该文件），中文分区名经一张 114 条的字典
 * 映成 AI JSON 键名。19 个模板全部推完零越界零重叠。推不出 `required`/`capacity`
 * （老 spec 里没有这两件事实），继续如实留白。
 *
 * ## 已存在的行怎么升级：**铸新版本**，不是原地改
 *
 * 已 backfill 过的组织里这些行是 `published`，而 published 的 `sections` 是**不可变快照**
 * （生命周期状态机的核心不变量）。所以补配置只能走 `mintTemplateVersion` → 新 draft →
 * `publishTemplate` 这条合法路径，与人类在后台点「编辑」得到的完全是同一条路径。
 * 已经带 `layout` 的行跳过 ⇒ 整个脚本仍然幂等，可安全重跑。
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
import { mintTemplateVersion } from "../src/application/canvas/mint-template-version";
import { listTemplates as listOrgTemplates } from "../src/application/canvas/list-templates";
import { buildBuiltinSections } from "../src/domain/canvas/builtin-template-config";
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
  /** 已存在但缺 `layout`，本次铸了新版本补上配置的模板数。 */
  readonly upgraded: number;
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
    let upgraded = 0;

    // 一次读全（含 archived），下面逐条判定"这个 key 现在是什么状况"。
    //
    // ⚠ 读的是**库里当前的 sections**，不是"我记得我灌过什么"——静态痕迹 ≠ 动态事实。
    // ⚠ 走 `listTemplates` **用例**而不是 `templates.list()` 仓储方法：后者回的是
    //   `Guarded<>`（可见性尚未拆封），裸取字段拿不到；而拆封需要一次可见性判定，
    //   那正是这个用例在做的事。同文件头那条纪律——写路径走真实用例，读路径没有理由例外。
    const { templates: existing } = await listOrgTemplates(
      { identity, templates, ids: { next: () => `backfill-${orgId}` } },
      { userId: actorId, orgId: org, filter: "all" },
    );
    const latestByKey = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      const prev = latestByKey.get(row.key);
      if (prev === undefined || row.version > prev.version) latestByKey.set(row.key, row);
    }

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

      // 推演出的完整配置：key / type / layout 全带上（见文件头「sections 字段映射」）。
      const sections = buildBuiltinSections(spec);

      // ── 已存在：判断它需不需要升级 ────────────────────────────────────────────
      const current = latestByKey.get(spec.key);
      if (current !== undefined) {
        const enriched = current.sections.every((sec) => sec.layout !== undefined);
        if (enriched) {
          console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} 已带配置，跳过（幂等）`);
          continue;
        }
        const minted = await mintTemplateVersion(
          { identity, templates },
          {
            userId: actorId, orgId: org, key: spec.key, displayName,
            underlyingType: "canvas", sections: [...sections], visibility: "org-wide",
          },
        );
        await publishTemplate(
          { identity, templates },
          { userId: actorId, orgId: org, key: spec.key, version: minted.version, visibility: "org-wide" },
        );
        upgraded += 1;
        console.log(
          `[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} ` +
          `v${current.version}→v${minted.version} 补齐配置并发布`,
        );
        continue;
      }

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
            sections: [...sections],
            visibility: "org-wide",
          },
        );
        created += 1;
        console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} created (v${outcome.version})`);
      } catch (e) {
        if (e instanceof CanvasError && e.reasonCode === "TEMPLATE_KEY_CONFLICT") {
          // 上面的 latestByKey 已经判过一遍"已存在"；走到这里说明是**并发**（另一个
          // 进程在这两步之间建了同一个 key）。如实跳过，不去猜它灌的是哪个版本。
          console.log(`[backfill-canvas-builtin-templates] org=${orgId} key=${spec.key} 并发占用，跳过`);
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
      `新建 ${created} 个（其中发布 ${published} 个），补齐配置 ${upgraded} 个，` +
      `已存在跳过 ${alreadyExisted - upgraded} 个。`,
    );
    return { orgId, actorId, total: specs.length, created, alreadyExisted, published, upgraded };
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
