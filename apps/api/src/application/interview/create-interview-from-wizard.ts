/**
 * `createInterviewFromWizard` —— 三步新建向导（F84，uc-6-2 R3 步骤1-3，AC2 / AC5）。
 *
 * ## 三步落在这一个函数里的理由
 *
 * 三步向导的产出是**一次性**的：选模板 → 选对象 → 生成提纲，中间没有一个用户可以
 * 中途保存退出再回来的持久状态（那种「向导草稿」是 [设计] 层面的推荐交互，R8 明确
 * 标成 [设计] 而非已裁决行为）。所以这里没有三个分离的应用层用例各自落一个状态机，
 * 只有一个编排函数，依次调三个仓储各自负责的那一件事：
 *
 * 1. **选模板** —— 有 `templateId` 就复用 `applyTemplate`（F82，套用即脱钩，
 *    带上分段/时长/数据字段三样）；没有就走 `WizardInterviewRepository.createBlankInterview`
 *    （A2「从空白开始」）。
 * 2. **选对象** —— 逐个调 `SubjectRepository.attachToSession`（F97 自己的注释原文：
 *    「这不是一个公开契约操作——三步向导建成后，选对象这一步会调这个方法」）；
 *    随后用 `getInterviewRosterSubjects`（F97）取**已过 R5 可见性判定**的对象背景，
 *    不直接读仓储的裸行——对象表的可见性判定只应该被判一次，此处复用而不是重判。
 * 3. **生成提纲** —— `generateOutlineDraft`（纯函数，domain/interview/outline.ts）
 *    把模板结构 + 对象背景 + 三要素揉成大纲草案，写入 `interview_outlines`，
 *    状态恒 `pending_confirm`（AC5：AI 生成的是草案，不是定稿）。
 *
 * ## 已知缺口（如实报告，不在此发明）
 *
 * - `SPLIT_SESSION_REQUIRED` / `SAME_ORG_LIMIT`：R3 步骤2「对象间存在上下级关系按
 *   UC-6.3 第9步默认拆场」与研究计划参数「同组织不超过2人」都依赖 F87（同意位/名单
 *   三态/拆场）与 F85（研究计划参数）尚未建的数据。契约的 `err` 里留了这两个码，
 *   本实现暂不触发——不编一套没有依据的上下级/组织归属判断。
 * - `AI_GENERATION_UNAVAILABLE`：本 feature 的大纲生成是确定性纯函数，没有外部依赖，
 *   因此这条错误路径恒不可达（domain/interview/outline.ts 文件头有完整解释）。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../artifact/ports";
import type { DecisionIdFactory } from "../identity/ports";
import type { InterviewSourceKindName, ScopeSelector } from "../../domain/interview/scope";
import { generateOutlineDraft } from "../../domain/interview/outline";
import { applyTemplate } from "./apply-template";
import type { TemplateRepository } from "./template-ports";
import type { OutlineRepository, WizardInterviewRepository } from "./outline-ports";
import type { ConsentSubmissionStore, SubjectRepository } from "./subject-ports";
import { getInterviewRosterSubjects } from "./subject-projections";

export interface CreateInterviewFromWizardDeps {
  readonly templates: TemplateRepository;
  readonly wizardInterviews: WizardInterviewRepository;
  readonly subjects: SubjectRepository;
  readonly consent: ConsentSubmissionStore;
  readonly outlines: OutlineRepository;
  readonly ids: IdFactory;
  readonly decisions: DecisionIdFactory;
}

export interface CreateInterviewFromWizardContextThree {
  readonly who: string;
  readonly situation: string;
  readonly decision: string;
}

export interface CreateInterviewFromWizardDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly scope: ScopeSelector;
  readonly sourceKind: InterviewSourceKindName;
  /** `null` = 「不用模板，从空白开始」（A2）。 */
  readonly templateId: string | null;
  readonly subjectIds: readonly string[];
  readonly context: CreateInterviewFromWizardContextThree;
}

export interface CreateInterviewFromWizardResult {
  readonly interviewId: string;
  readonly outlineId: string;
  readonly outlineStatus: "pending_confirm";
  /** 供调用方/测试直接断言「模板带入的三样」，不需要另外去读 `getAppliedSnapshot`。 */
  readonly appliedTemplateVersionId: string | null;
  readonly templateSections: readonly { readonly name: string; readonly minutes: number; readonly order: number }[];
  readonly templateDataFields: readonly {
    readonly fieldId: string;
    readonly name: string;
    readonly kind: string;
    readonly required: boolean;
  }[];
}

export async function createInterviewFromWizard(
  deps: CreateInterviewFromWizardDeps,
  input: CreateInterviewFromWizardDto,
): Promise<CreateInterviewFromWizardResult> {
  // 第一步 · 选模板（或从空白开始）。
  let interviewId: string;
  let appliedTemplateVersionId: string | null = null;
  let templateSections: CreateInterviewFromWizardResult["templateSections"] = [];
  let templateDataFields: CreateInterviewFromWizardResult["templateDataFields"] = [];

  if (input.templateId !== null) {
    const applied = await applyTemplate(
      { repo: deps.templates, ids: deps.ids },
      {
        orgId: input.orgId,
        actorId: input.actorId,
        templateId: input.templateId,
        versionId: null,
        targetInterviewId: null,
      },
    );
    interviewId = applied.interviewId;
    appliedTemplateVersionId = applied.appliedTemplateVersionId;
    templateSections = applied.sections;
    templateDataFields = applied.dataFields;
  } else {
    interviewId = deps.ids.next("itv");
    await deps.wizardInterviews.createBlankInterview({
      orgId: input.orgId,
      interviewId,
      projectId: input.scope.projectId,
      researchProjectId: input.scope.researchProjectId,
      sourceKind: input.sourceKind,
      title: "未命名访谈",
      createdBy: input.actorId,
    });
  }

  // 第二步 · 选对象：排进名单，随后按 R5 已判定可见性读回背景（不直接读裸行）。
  for (const subjectId of input.subjectIds) {
    await deps.subjects.attachToSession(input.orgId, interviewId, subjectId, input.actorId);
  }
  const rosterSubjects =
    input.subjectIds.length === 0
      ? []
      : await getInterviewRosterSubjects(
          { subjects: deps.subjects, consent: deps.consent, decisions: deps.decisions },
          input.orgId,
          input.actorId,
          interviewId,
        );

  // 第三步 · 生成提纲——草案，状态恒 pending_confirm（AC5）。
  const sections = generateOutlineDraft({
    templateSections,
    templateDataFields,
    subjects: rosterSubjects.map((s) => ({
      subjectId: s.subjectId,
      displayName: s.displayName,
      roleTitle: s.roleTitle,
      orgName: s.orgName,
      backgroundAndQuestions: s.backgroundAndQuestions,
    })),
    context: input.context,
  });

  const outlineId = deps.ids.next("outline");
  const outline = await deps.outlines.create({
    orgId: input.orgId,
    outlineId,
    interviewId,
    sections,
    generatedBy: input.actorId,
  });

  return {
    interviewId,
    outlineId: outline.outlineId,
    outlineStatus: "pending_confirm",
    appliedTemplateVersionId,
    templateSections,
    templateDataFields,
  };
}
