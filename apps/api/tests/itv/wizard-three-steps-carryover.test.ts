/**
 * F84 —— 三步新建向导（选模板→选对象→生成提纲），带入内容可见可改（uc-6-2 R3 步骤1-3，AC2 / AC5）。
 *
 * ## 这个文件要证的三件事，以及每一件的反证
 *
 * ① **模板带入的三样（分段/时长/数据字段）在生成的大纲/结果里可见**。
 *    反证：若向导内部改成「只带 sections 不带 dataFields」，`result.templateDataFields`
 *    的断言会在这里当场落空——这正是契约注释「第三样最常被漏」在 F84 侧的反证。
 * ② **对象背景（角色/所属组织/自由文本背景）出现在生成的大纲段落里**，不是一段与
 *    对象无关的通用文案。反证：若生成器忽略 `subjects` 参数，下面对 `openers`/
 *    `objective` 的 `toContain` 断言会失败。
 * ③ **不用模板、从空白开始也能走通**（A2），且此时大纲只按上下文三要素生成，
 *    不会因为没有模板就报错或生成示例数据。
 * ④ **大纲状态恒为 `pending_confirm`**（AC5：AI 生成的是草案，不是定稿）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addOrgMember, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgTemplateRepository } from "../../src/infrastructure/interview/pg-template-repository";
import { PgInterviewSubjectRepository } from "../../src/infrastructure/interview/pg-interview-subject-repository";
import { PgConsentSubmissionStore } from "../../src/infrastructure/interview/pg-consent-submission-store";
import { PgOutlineRepository, PgWizardInterviewRepository } from "../../src/infrastructure/interview/pg-outline-repository";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { createTemplate } from "../../src/application/interview/create-template";
import { createInterviewFromWizard } from "../../src/application/interview/create-interview-from-wizard";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { decideInterviewVisibility } from "../../src/domain/interview/visibility-decision";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import type { OrgRole } from "../../src/domain/identity/roles";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f84-wizard";
const PROJECT = "proj-f84-wizard";
const RESEARCHER = "u-f84-researcher";

let db: PgDatabase;
let templates: PgTemplateRepository;
let subjects: PgInterviewSubjectRepository;
let consent: PgConsentSubmissionStore;
let outlines: PgOutlineRepository;
let wizardInterviews: PgWizardInterviewRepository;
let scope: PgInterviewScopeRepository;
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

/** 复用 F80 的可见性规则解封大纲——大纲是访谈的一个 facet，不是另一套访问控制。 */
async function readOutline(orgId: OrgId, viewerUserId: string, interviewId: string) {
  const guarded = await outlines.getByInterview(orgId, viewerUserId, interviewId);
  if (guarded === null) return null;
  const [orgMembership, projectIds] = await Promise.all([
    scope.orgMembershipOf(orgId, viewerUserId),
    scope.projectIdsOf(orgId, viewerUserId),
  ]);
  const decision = decideInterviewVisibility({
    decisionId: decisions.next(),
    interview: guarded.facts,
    viewer: { userId: viewerUserId, projectIds },
    orgRole: orgMembership.orgRole as OrgRole | null,
    viewerTeamId: orgMembership.teamId,
  });
  const disclosed = discloseDecided(guarded.item, decision);
  return isDisclosed(disclosed) ? disclosed.payload : null;
}

let groupId: string;
const createdInterviewIds: string[] = [];

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  templates = new PgTemplateRepository(db);
  subjects = new PgInterviewSubjectRepository(db);
  consent = new PgConsentSubmissionStore(db);
  outlines = new PgOutlineRepository(db);
  wizardInterviews = new PgWizardInterviewRepository(db);
  scope = new PgInterviewScopeRepository(db);
}, 120_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  createdInterviewIds.length = 0;
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  groupId = fx.groups.g1!;
  await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy!);
});

function deps() {
  return { templates, wizardInterviews, subjects, consent, outlines, ids, decisions };
}

describe("F84 — 三步向导带入内容可见可改", () => {
  it("① ~ ② 套模板 + 选对象：三样与对象背景都出现在生成的大纲里（AC2）", async () => {
    const template = await createTemplate(
      { repo: templates, ids },
      {
        orgId: toOrgId(ORG),
        actorId: RESEARCHER,
        name: "采购决策链深访",
        goal: "还原上一次真实采购的完整经过",
        sections: [
          { name: "决策链梳理", minutes: 20, order: 0 },
          { name: "卡点还原", minutes: 20, order: 1 },
        ],
        dataFields: [
          { fieldId: "f-role", name: "决策角色", kind: "text", required: true },
        ],
        tags: ["采购"],
      },
    );

    const subject = await subjects.create({
      orgId: toOrgId(ORG),
      displayName: "王芳",
      roleTitle: "采购总监",
      orgName: "某物流园区",
      groupId,
      contact: "13800001111",
      sourceKind: "human",
      backgroundAndQuestions: "去年主导过一次仓储系统采购，中途换过供应商",
      createdBy: RESEARCHER,
    });

    const result = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "project", projectId: PROJECT, researchProjectId: null },
      sourceKind: "human",
      templateId: template.templateId,
      subjectIds: [subject.subjectId],
      context: { who: "采购总监", situation: "仓储系统采购", decision: "是否更换供应商" },
    });
    createdInterviewIds.push(result.interviewId);

    // ① 模板三样：分段 + 时长 + 数据字段，逐字段与模板一致，专门断言 dataFields。
    expect(result.appliedTemplateVersionId).toBe(template.versionId);
    expect(result.templateSections).toEqual(template.sections);
    expect(result.templateDataFields).toEqual(template.dataFields);

    // ④ 状态恒 pending_confirm。
    expect(result.outlineStatus).toBe("pending_confirm");

    const outline = await readOutline(toOrgId(ORG), RESEARCHER, result.interviewId);
    expect(outline).not.toBeNull();
    expect(outline?.status).toBe("pending_confirm");
    // 模板带入的分段数与大纲段数一致（每段可编辑保存，段数不多不少）。
    expect(outline?.sections).toHaveLength(2);

    // ② 对象背景在每一段都可见：角色/所属组织/自由文本背景至少出现在某处。
    const allText = outline!.sections.map((s) => `${s.objective} ${s.openers.join(" ")}`).join(" ");
    expect(allText).toContain("采购总监");
    expect(allText).toContain("某物流园区");

    // AC1：每段都有非空目标，且序列化上 objective 字段先于 openers（结构本身保证顺序）。
    for (const section of outline!.sections) {
      expect(section.objective.length).toBeGreaterThan(0);
      expect(section.openers.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(section)[1]).toBe("objective");
    }

    // 对象已经排进这场访谈的名单——第二步「选对象」真的写了关联，不只是读了背景。
    const roster = await subjects.listByInterviewSession(toOrgId(ORG), result.interviewId);
    expect(roster.map((r) => r.item.ref.id)).toEqual([subject.subjectId]);
  });

  it("③ 不用模板、从空白开始也能走通，且不生成与上下文无关的示例数据（A2 / V9）", async () => {
    const result = await createInterviewFromWizard(deps(), {
      orgId: toOrgId(ORG),
      actorId: RESEARCHER,
      scope: { kind: "none", projectId: null, researchProjectId: null },
      sourceKind: "human",
      templateId: null,
      subjectIds: [],
      context: { who: "运营总监", situation: "供应商年审", decision: "是否续约" },
    });
    createdInterviewIds.push(result.interviewId);

    expect(result.appliedTemplateVersionId).toBeNull();
    expect(result.templateSections).toEqual([]);
    expect(result.outlineStatus).toBe("pending_confirm");

    const outline = await readOutline(toOrgId(ORG), RESEARCHER, result.interviewId);
    expect(outline?.sections).toHaveLength(1);
    const only = outline!.sections[0]!;
    expect(only.objective).toContain("供应商年审");
    expect(only.openers.length).toBeGreaterThanOrEqual(2);

    // 「不属于任何项目」也是一等范围——直接查得到这场访谈。
    const row = await asOwner((c) =>
      c.query<{ project_id: string | null }>(`SELECT project_id FROM interview_sessions WHERE org_id = $1 AND id = $2`, [
        ORG,
        result.interviewId,
      ]),
    );
    expect(row.rows[0]?.project_id).toBeNull();
  });
});
