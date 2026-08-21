/**
 * #1680 —— F26 三个用例（`saveAsOrgTemplate` / `switchWorkflowTemplate` /
 * `getWorkflowOrchestration`）首次接上真实 Postgres 的存储侧证据。
 *
 * ## 这个文件在钉什么
 *
 * 三个用例的纯编排早就被单测覆盖（`tests/tpl/workflow-template-two-level.test.ts`/
 * `save-as-org-template.test.ts` 等），但那些单测全部对着内存 Fake 端口跑——「换模板
 * 之后再读，读到的是不是真的写进了库」这件事在本文件之前没有任何覆盖。断言全部落在
 * 真实 `BlueprintController` 实例 + 真实 `project_workflow_orchestration`/
 * `workflow_template_catalog` 两张表的行上，不是纯用例的返回值。
 *
 * ## 覆盖的三条真实读写路径
 *
 *   ① `saveAsOrgTemplate` → `workflow_template_catalog` 真的多一行，且新 id ≠ 来源模板 id。
 *   ② `switchWorkflowTemplate`（`confirmed:true`）→ `project_workflow_orchestration`
 *      真的被换成目标模板的环节链与矩阵（cellId 由 `newCellId` 重新分配）。
 *   ③ `getWorkflowOrchestration` → 读到的正是 ② 刚写入的那份快照，不是缓存或猜测值。
 *   ④ `switchWorkflowTemplate`（`confirmed:false`，有破坏性变更）→ **零写入**：
 *      再次 `getWorkflowOrchestration` 读到的编排必须与破坏性尝试之前完全一致。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { BlueprintController } from "../../src/interface/controllers/blueprint.controller";
import {
  PgOrchestrationRepository,
  PgOrgTemplateCreateRepository,
  PgWorkflowTemplateCatalogRepository,
} from "../../src/infrastructure/templates/pg-workflow-orchestration-repository";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "i1680-tpl-org";
const FACILITATOR = "u-i1680-facilitator";
const MEMBER = "u-i1680-member";
// ⚠ 观察者是四个项目角色里**唯一**在 `PROJECT_ROLE_MATRIX` 没有任何写动作的一档
// （`domain/identity/project-role-matrix.ts`）——`member`/`groupLead` 都持有
// `content.postNote` 一类写动作，同样通过 `canWriteOrchestration`，不能拿来触发
// `ROLE_INSUFFICIENT`。
const OBSERVER = "u-i1680-observer";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let controller: BlueprintController;
let orchestrations: PgOrchestrationRepository;
let catalog: PgWorkflowTemplateCatalogRepository;

function ids() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}-test-${++n}-${Math.random().toString(36).slice(2, 8)}` };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  orchestrations = new PgOrchestrationRepository(db);
  catalog = new PgWorkflowTemplateCatalogRepository(db);
  const orgTemplateCreate = new PgOrgTemplateCreateRepository(db, ids());
  const identity = new (
    await import("../../src/infrastructure/identity/pg-identity-repository")
  ).PgIdentityRepository(db);
  controller = new BlueprintController(
    {} as never, // BLUEPRINT_PERSISTENCE_PORT — 本文件不碰蓝本路径
    identity,
    ids() as never,
    {} as never, // PROJECT_PREP_REPOSITORY
    {} as never, // PROJECT_TOPIC_REPOSITORY
    {} as never, // GROUPING_REPOSITORY
    {} as never, // INTERVIEW_SUBJECTS_REPOSITORY
    orchestrations,
    catalog,
    orgTemplateCreate,
  );
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
}, HOOK_TIMEOUT_MS);

const PROJECT = "i1680-tpl-project";

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, PROJECT, FACILITATOR, "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, MEMBER, "member", null, false);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null, false);
}, HOOK_TIMEOUT_MS);

/** 造一个后台工作流模板目录项，绕开 saveAsOrgTemplate（那是本文件要独立断言的写点）。 */
async function seedCatalogEntry(templateId: string, name: string): Promise<void> {
  await db.withTenant(toOrgId(ORG), async (s) => {
    await s.query(
      `INSERT INTO workflow_template_catalog (id, org_id, name, source_version, segments, matrix)
       VALUES ($1, $2, $3, 2, $4::jsonb, $5::jsonb)`,
      [
        templateId,
        ORG,
        name,
        JSON.stringify([
          { agendaSegmentId: "seg-1", title: "开场", addedBy: null, optional: false },
          { agendaSegmentId: "seg-2", title: "深挖", addedBy: null, optional: false },
        ]),
        JSON.stringify([
          {
            cellId: "seed-cell-1",
            agendaSegmentId: "seg-1",
            roleKey: "facilitator",
            content: "破冰",
            canvasTemplateId: null,
            skillIds: [],
          },
        ]),
      ],
    );
  });
}

const PRINCIPAL = (userId: string) => ({ userId, orgId: ORG }) as never;

describe("#1680 F26 工作流编排真实落库", () => {
  it("① switchWorkflowTemplate(confirmed:true) 真的把编排写进 project_workflow_orchestration", async () => {
    await seedCatalogEntry("wft-seed-a", "标准五步法");

    const out = await controller.switchWorkflowTemplateRoute(
      PROJECT,
      { templateId: "wft-seed-a", confirmed: true } as never,
      PRINCIPAL(FACILITATOR),
    );
    expect(out.applied).toBe(true);

    const row = await orchestrations.load(toOrgId(ORG), PROJECT);
    expect(row).not.toBeNull();
    expect(row!.template.templateId).toBe("wft-seed-a");
    expect(row!.segments.map((s) => s.agendaSegmentId)).toEqual(["seg-1", "seg-2"]);
    // ⚠ cellId 必须是 `newCellId` 重新分配的那一批，不是目录项里的 `seed-cell-1`——
    //   同用例头注：矩阵格 id 由调用方注入，不是从模板照搬。
    expect(row!.matrix).toHaveLength(1);
    expect(row!.matrix[0]!.cellId).not.toBe("seed-cell-1");
    expect(row!.matrix[0]!.agendaSegmentId).toBe("seg-1");
  });

  it("② getWorkflowOrchestration 读到的正是刚写入的那份快照", async () => {
    await seedCatalogEntry("wft-seed-b", "精简三步法");
    await controller.switchWorkflowTemplateRoute(
      PROJECT,
      { templateId: "wft-seed-b", confirmed: true } as never,
      PRINCIPAL(FACILITATOR),
    );

    const out = await controller.getOrchestration(PROJECT, PRINCIPAL(MEMBER));
    expect(out.template.templateId).toBe("wft-seed-b");
    expect(out.template.name).toBe("精简三步法");
    expect(out.segmentChain.map((s) => s.agendaSegmentId)).toEqual(["seg-1", "seg-2"]);
  });

  it("③ 破坏性换模板 confirmed:false 零写入——再读编排与尝试之前逐字节一致", async () => {
    await seedCatalogEntry("wft-seed-c1", "五段式");
    await controller.switchWorkflowTemplateRoute(
      PROJECT,
      { templateId: "wft-seed-c1", confirmed: true } as never,
      PRINCIPAL(FACILITATOR),
    );
    const before = await orchestrations.load(toOrgId(ORG), PROJECT);

    // 目标模板环节链与来源完全不重叠 ⇒ 必为破坏性（lostSegments 非空）。
    await db.withTenant(toOrgId(ORG), async (s) => {
      await s.query(
        `INSERT INTO workflow_template_catalog (id, org_id, name, source_version, segments, matrix)
         VALUES ('wft-seed-c2', $1, '完全不同的模板', 1, $2::jsonb, '[]'::jsonb)`,
        [ORG, JSON.stringify([{ agendaSegmentId: "seg-other", title: "别的环节", addedBy: null, optional: false }])],
      );
    });

    const out = await controller.switchWorkflowTemplateRoute(
      PROJECT,
      { templateId: "wft-seed-c2", confirmed: false } as never,
      PRINCIPAL(FACILITATOR),
    );
    expect(out.applied).toBe(false);
    expect(out.impact.lostSegments.length).toBeGreaterThan(0);

    const after = await orchestrations.load(toOrgId(ORG), PROJECT);
    expect(after).toEqual(before);
  });

  it("④ saveAsOrgTemplate 真的在 workflow_template_catalog 多一行，且新 id ≠ 来源模板 id", async () => {
    await seedCatalogEntry("wft-seed-d", "起点模板");
    await controller.switchWorkflowTemplateRoute(
      PROJECT,
      { templateId: "wft-seed-d", confirmed: true } as never,
      PRINCIPAL(FACILITATOR),
    );

    const out = await controller.saveAsOrgTemplateRoute(
      PROJECT,
      { name: "另存出来的新模板" } as never,
      PRINCIPAL(FACILITATOR),
    );
    expect(out.workflowTemplateId).not.toBe("wft-seed-d");

    const saved = await catalog.load(toOrgId(ORG), out.workflowTemplateId);
    expect(saved).not.toBeNull();
    expect(saved!.name).toBe("另存出来的新模板");
    expect(saved!.segments.map((s) => s.agendaSegmentId)).toEqual(["seg-1", "seg-2"]);

    // 来源模板本体（`wft-seed-d`）必须原封不动——「另存」不是「覆写」（I-17）。
    const source = await catalog.load(toOrgId(ORG), "wft-seed-d");
    expect(source!.name).toBe("起点模板");
  });

  it("⑤ 观察者（无写权限角色）被拒，且不写入任何行", async () => {
    await seedCatalogEntry("wft-seed-e", "任意模板");

    await expect(
      controller.switchWorkflowTemplateRoute(
        PROJECT,
        { templateId: "wft-seed-e", confirmed: true } as never,
        PRINCIPAL(OBSERVER),
      ),
    ).rejects.toThrow();

    const row = await orchestrations.load(toOrgId(ORG), PROJECT);
    expect(row).toBeNull();
  });
});
