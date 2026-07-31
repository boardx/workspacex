/**
 * F82 —— `用过 N 次` 是统计投影，不可手填（uc-6-1 R3 步骤0 / A2 / R7, AC2, V2, I-8）。
 *
 * ## 三层反证，各挡一种「手填」的形态
 *
 * ① **契约层**：`createTemplate`/`updateTemplate` 的 zod schema 是 `.strict()`，
 *    多一个 `usedCount` 键就整体拒绝——这是「构造出来的写请求」在到达任何业务代码之前
 *    就已经被挡下的证据，不是靠应用层记得检查。
 * ② **schema 层**：`interview_templates` / `interview_template_versions` /
 *    `interview_template_applications` 三张表里**没有任何一列**是「计数」的语义——
 *    用 `information_schema.columns` 现查证明，而不是读代码相信注释。
 * ③ **行为层**：连续套用同一模板 3 次，`usedCount` 必须恰好递增 3；模板产生新版本后
 *    再套用 2 次，`usedCount` 是**全部版本的累计** 5（A2），不是按版本分别计数从 0 起跳。
 *
 * 反证：把 `PgTemplateRepository.usedCount`/`list` 的 `COUNT(a.id)` 换成任何「读一个缓存整数」
 * 的写法，③ 的递增断言在没有配套的写路径时会读到 0（或陈旧值），当场红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interview } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTemplateRepository } from "../../src/infrastructure/interview/pg-template-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { createTemplate } from "../../src/application/interview/create-template";
import { updateTemplate } from "../../src/application/interview/update-template";
import { applyTemplate } from "../../src/application/interview/apply-template";
import { getTemplate } from "../../src/application/interview/get-template";
import { listTemplates } from "../../src/application/interview/list-templates";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f82-usedcount";
const PROJECT = "proj-f82-usedcount";
const RESEARCHER = "u-f82-uc-researcher";

let db: PgDatabase;
let repo: PgTemplateRepository;
const ids = new UuidIdFactory();

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgTemplateRepository(db);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
});

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F82 usedCount 不可手填", () => {
  it("① 契约层：写请求里带 usedCount 被 .strict() schema 整体拒绝", () => {
    const validCreate = {
      name: "n", goal: "g",
      sections: [{ name: "s", minutes: 10, order: 0 }],
      dataFields: [{ fieldId: "f", name: "n", kind: "text", required: true }],
      tags: [] as string[],
    };

    const withUsedCount = { ...validCreate, usedCount: 999 };
    expect(interview.operations.createTemplate.in.safeParse(withUsedCount).success).toBe(false);
    expect(interview.operations.createTemplate.in.safeParse(validCreate).success).toBe(true);

    const validUpdate = { ...validCreate, templateId: "tpl-x", expectedVersionNumber: 1 };
    expect(
      interview.operations.updateTemplate.in.safeParse({ ...validUpdate, usedCount: 999 }).success,
    ).toBe(false);
    expect(interview.operations.updateTemplate.in.safeParse(validUpdate).success).toBe(true);
  });

  it("② schema 层：没有任何一张模板相关表存在计数类列可写", async () => {
    ensureDatabase();
    await migrateOnce();
    const cols = await asApp(null, (c) =>
      c.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN
                ('interview_templates', 'interview_template_versions', 'interview_template_applications')`,
      ),
    );
    const suspicious = cols.rows.filter((r) => /count|usage|used_n|times/i.test(r.column_name));
    expect(suspicious).toEqual([]);
  });

  it("③ 行为层：连续套用 3 次递增 3；换版本后再套用 2 次，累计到 5（A2 跨版本累计）", async () => {

    const v1 = await createTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        name: "采购决策链",
        goal: "谁拍板、谁能否决、卡在哪一步",
        sections: [{ name: "决策链梳理", minutes: 30, order: 0 }],
        dataFields: [{ fieldId: "f-decider", name: "拍板人", kind: "text", required: true }],
        tags: ["高优先级"],
      },
    );

    for (let i = 0; i < 3; i++) {
      await applyTemplate(
        { repo, ids },
        { orgId: toOrgId(ORG), actorId: RESEARCHER, templateId: v1.templateId, versionId: null, targetInterviewId: null },
      );
    }

    const afterThree = await getTemplate({ repo }, toOrgId(ORG), v1.templateId);
    expect(afterThree?.usedCount).toBe(3);

    // listTemplates 走的是另一条查询路径（GROUP BY 版本），必须给出同一个数——
    // 两处事实源必须一致，这正是本项目反复漂移的形状。
    const rows = await listTemplates({ repo }, toOrgId(ORG));
    const row = rows.find((r) => r.templateId === v1.templateId);
    expect(row?.usedCount).toBe(3);

    // 编辑产生 v2（A2：`用过 N 次` 是全部版本的累计，不是按版本清零重来）。
    const v2 = await updateTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        templateId: v1.templateId,
        expectedVersionNumber: 1,
        name: v1.name,
        goal: v1.goal,
        sections: v1.sections,
        dataFields: v1.dataFields,
        tags: v1.tags,
      },
    );
    expect(v2.versionNumber).toBe(2);

    for (let i = 0; i < 2; i++) {
      await applyTemplate(
        { repo, ids },
        { orgId: toOrgId(ORG), actorId: RESEARCHER, templateId: v1.templateId, versionId: null, targetInterviewId: null },
      );
    }

    const afterFive = await getTemplate({ repo }, toOrgId(ORG), v1.templateId);
    expect(afterFive?.usedCount).toBe(5);
  });

  it("直接写 SQL 试图伪造一个计数列：该列压根不存在，数据库拒绝而不是静默接受", async () => {
    const created = await createTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        name: "临时模板",
        goal: "仅用于验证不可手填",
        sections: [{ name: "s", minutes: 10, order: 0 }],
        dataFields: [{ fieldId: "f", name: "n", kind: "text", required: true }],
        tags: [],
      },
    );

    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE interview_templates SET used_count = 999 WHERE org_id = $1 AND id = $2`, [
          ORG,
          created.templateId,
        ]),
      ),
    ).rejects.toThrow(/column "used_count" of relation "interview_templates" does not exist/i);
  });
});
