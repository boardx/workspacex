/**
 * F82 —— 模板套用带上三样东西，且套用即脱钩（uc-6-1 R3 步骤4 / A2 / R7, AC1 / AC4, V1 / V4）。
 *
 * ## 这个文件要证的三件事，以及每一件的反证
 *
 * ① **套用把三样（分段/时长/数据字段）一次性带进新访谈**，逐字段与模板一致。
 *    反证：随手漏掉 `dataFields` 是这条规则最常见的破法（contracts 注释原文「第三样最常被漏」）——
 *    断言专门覆盖 `dataFields`，不是只看 `sections`。
 *
 * ② **模板产生新版本后，已套用的访谈读到的三样东西一个字节都不变**。
 *    反证：若 `getAppliedSnapshot` 被改成「联查模板当前 head」而不是读自己的副本，
 *    这里的断言会在 `updateTemplate` 之后变成读到**新**内容，而不是原内容 —— 当场红。
 *
 * ③ **反过来，直接改这场访谈自己的副本，不会写回模板**。
 *    反证：若 `apply()` 被改成写一个指向模板版本的外键联查而不是复制一份，
 *    这里对访谈副本的直接 SQL 改写会“順便”改到模板返回的内容——下面的
 *    `expect(afterEdit.sections).not.toEqual(templateHeadAfter.sections)` 就会翻车。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTemplateRepository } from "../../src/infrastructure/interview/pg-template-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { createTemplate } from "../../src/application/interview/create-template";
import { updateTemplate } from "../../src/application/interview/update-template";
import { applyTemplate } from "../../src/application/interview/apply-template";
import { getTemplate } from "../../src/application/interview/get-template";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f82-detach";
const PROJECT = "proj-f82-detach";
const RESEARCHER = "u-f82-researcher";

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

describe("F82 套用带三样 + 脱钩", () => {
  it("① 套用一次性带上分段/时长/数据字段，且逐字段与模板一致（AC1 / V1）", async () => {
    const created = await createTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        name: "JTBD 深访",
        goal: "还原上一次真实购买的完整经过",
        sections: [
          { name: "开场破冰", minutes: 5, order: 0 },
          { name: "购买触发", minutes: 20, order: 1 },
          { name: "决策过程", minutes: 20, order: 2 },
        ],
        dataFields: [
          { fieldId: "f-role", name: "角色", kind: "text", required: true },
          { fieldId: "f-budget", name: "预算区间", kind: "enum", required: false },
        ],
        tags: ["客户"],
      },
    );

    const applied = await applyTemplate(
      { repo, ids },
      { orgId: toOrgId(ORG), actorId: RESEARCHER, templateId: created.templateId, versionId: null, targetInterviewId: null },
    );

    expect(applied.appliedTemplateVersionId).toBe(created.versionId);
    expect(applied.sections).toEqual(created.sections);
    // ⚠ 专门断言 dataFields —— 这是最容易被漏掉的第三样。
    expect(applied.dataFields).toEqual(created.dataFields);

    const snapshot = await repo.getAppliedSnapshot(toOrgId(ORG), applied.interviewId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.sections).toEqual(created.sections);
    expect(snapshot?.dataFields).toEqual(created.dataFields);
    expect(snapshot?.templateVersionId).toBe(created.versionId);
  });

  it("② 套用后编辑模板产生新版本，已套用的访谈内容不变；③ 反过来编辑访谈副本也不写回模板（AC4 / V4）", async () => {
    const v1 = await createTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        name: "竞品切换动因",
        goal: "为什么换、为什么没换",
        sections: [{ name: "切换契机", minutes: 20, order: 0 }],
        dataFields: [{ fieldId: "f-competitor", name: "竞品名称", kind: "text", required: true }],
        tags: ["内部"],
      },
    );

    const applied = await applyTemplate(
      { repo, ids },
      { orgId: toOrgId(ORG), actorId: RESEARCHER, templateId: v1.templateId, versionId: null, targetInterviewId: null },
    );

    const beforeUpdate = await repo.getAppliedSnapshot(toOrgId(ORG), applied.interviewId);
    expect(beforeUpdate?.sections).toEqual(v1.sections);

    // 编辑模板 —— 分段/时长/数据字段全换掉，产生 v2。
    const v2 = await updateTemplate(
      { repo, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        templateId: v1.templateId,
        expectedVersionNumber: 1,
        name: "竞品切换动因（修订）",
        goal: "为什么换、为什么没换 —— 增加价格敏感度追问",
        sections: [
          { name: "切换契机", minutes: 15, order: 0 },
          { name: "价格敏感度", minutes: 15, order: 1 },
        ],
        dataFields: [
          { fieldId: "f-competitor", name: "竞品名称", kind: "text", required: true },
          { fieldId: "f-price", name: "价格敏感度", kind: "scale", required: true },
        ],
        tags: ["内部"],
      },
    );
    expect(v2.versionId).not.toBe(v1.versionId);
    expect(v2.versionNumber).toBe(2);

    // ② 已套用的这场访谈——三样东西必须原封不动，不随模板新版本变化。
    const afterTemplateUpdate = await repo.getAppliedSnapshot(toOrgId(ORG), applied.interviewId);
    expect(afterTemplateUpdate?.sections).toEqual(v1.sections);
    expect(afterTemplateUpdate?.dataFields).toEqual(v1.dataFields);
    expect(afterTemplateUpdate?.templateVersionId).toBe(v1.versionId);

    // 模板这一侧确实变了（不是「什么都没变所以巧合地相等」）。
    const templateHeadAfterUpdate = await getTemplate({ repo }, toOrgId(ORG), v1.templateId);
    expect(templateHeadAfterUpdate?.sections).toEqual(v2.sections);
    expect(templateHeadAfterUpdate?.sections).not.toEqual(afterTemplateUpdate?.sections);

    // 已套用的访谈行的引用列（applied_template_version_id）也仍固化在 v1，不随模板 head 走。
    const sessionRow = await asApp(ORG, (c) =>
      c.query<{ applied_template_version_id: string }>(
        `SELECT applied_template_version_id FROM interview_sessions WHERE org_id = $1 AND id = $2`,
        [ORG, applied.interviewId],
      ),
    );
    expect(sessionRow.rows[0]?.applied_template_version_id).toBe(v1.versionId);

    // ③ 反过来：直接改这场访谈自己的副本（模拟未来 Outline 编辑器的写入路径 —— 那条写入
    // 路径本身不是 F82 的范围，`app_rw` 现在也确实没有这张表的 UPDATE 授权，见迁移文件；
    // 这里用 owner 连接只是为了在编辑器落地之前，先证明「即使写了也不会传导回模板」）。
    // 断言模板版本行（无论 v1 还是当前 head v2）都不受影响。
    const editedSections = [{ name: "研究员手改的段落", minutes: 99, order: 0 }];
    await asOwner((c) =>
      c.query(
        `UPDATE interview_template_applications SET sections = $1::jsonb WHERE org_id = $2 AND interview_id = $3`,
        [JSON.stringify(editedSections), ORG, applied.interviewId],
      ),
    );

    const templateHeadAfterInterviewEdit = await getTemplate({ repo }, toOrgId(ORG), v1.templateId);
    expect(templateHeadAfterInterviewEdit?.sections).toEqual(v2.sections);
    expect(templateHeadAfterInterviewEdit?.sections).not.toEqual(editedSections);

    const v1Row = await repo.getVersion(toOrgId(ORG), v1.templateId, v1.versionId);
    expect(v1Row?.sections).toEqual(v1.sections);
    expect(v1Row?.sections).not.toEqual(editedSections);

    // 来源引用仍在（AC4「仍保留来源引用」）：即便访谈自己的副本已经被改写，
    // 它引用的模板版本 id 依然可查、依然是 v1。
    const snapshotAfterEdit = await repo.getAppliedSnapshot(toOrgId(ORG), applied.interviewId);
    expect(snapshotAfterEdit?.templateVersionId).toBe(v1.versionId);
  });

  it("模板版本行在数据库层不可改写（A2 / I-9 的第二道门，不只在用例里）", async () => {
    const created = await createTemplate(
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

    // 门 ①：运行时角色（app_rw）根本没有 UPDATE/DELETE 权限——REVOKE 挡在触发器之前。
    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE interview_template_versions SET name = 'hacked' WHERE org_id = $1 AND id = $2`, [
          ORG,
          created.versionId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);

    // 门 ②：即便绕开 GRANT（以 owner 身份直连，这是唯一比 app_rw 权限更宽的路径），
    // 触发器仍然拒绝——不可变不是靠「没给权限」这一件事撑着。
    await expect(
      asOwner((c) =>
        c.query(`UPDATE interview_template_versions SET name = 'hacked' WHERE org_id = $1 AND id = $2`, [
          ORG,
          created.versionId,
        ]),
      ),
    ).rejects.toThrow(/TEMPLATE_VERSION_IMMUTABLE/);

    await expect(
      asOwner((c) =>
        c.query(`DELETE FROM interview_template_versions WHERE org_id = $1 AND id = $2`, [ORG, created.versionId]),
      ),
    ).rejects.toThrow(/TEMPLATE_VERSION_IMMUTABLE/);
  });
});
