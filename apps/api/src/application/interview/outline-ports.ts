/**
 * Ports for the outline + wizard write path (F84, uc-6-2 C 组).
 *
 * ## 为什么「新建一场空白访谈」的写入落在这里,不在 `template-ports.ts`
 *
 * `TemplateRepository.apply()`（F82）只覆盖「套模板新建」这一条路径——它的输入
 * 恒有一个 `templateId`。三步向导第一步允许「不用模板,从空白开始」（A2),
 * 这条路径压根不经过任何模板,所以不能塞进 `ApplyTemplateInput`（那会逼着调用方
 * 编一个不存在的 `templateId`）。0020 迁移的注释原文写着「写入路径(新建向导)是
 * F84」——这个端口就是那句话的落点。
 *
 * ## 大纲为什么是「一场访谈一行,不建版本表」
 *
 * `interview_template_versions` 建版本表是因为模板要跨访谈复用、要支持「已套用的
 * 不受影响」（脱钩）。大纲不是复用资产,它是这一场访谈自己的草稿——`regenerate`
 * 覆盖的是同一行,而不是新增一版供谁引用。若某天需要「大纲历史版本可追溯」,
 * 那是在这张表之上加一张审计表,不是现在就为一个没人依赖的需求建版本链。
 */
import type { OrgId } from "../../domain/org-id";
import type { OutlineSectionDraft } from "../../domain/interview/outline";
import type { InterviewSourceKindName, InterviewVisibilityFacts } from "../../domain/interview/scope";
import type { Guarded } from "../security/permission-filter";

export type OutlineStatusName = "pending_confirm" | "confirmed";

export interface OutlineSectionRecord extends OutlineSectionDraft {
  readonly sectionId: string;
  /** 提纲勾选态（uc-6-4 F90 的范围）。F84 只建列,不写非 null 值。 */
  readonly status: "done" | "deferred" | null;
}

export interface OutlineRecord {
  readonly outlineId: string;
  readonly interviewId: string;
  readonly status: OutlineStatusName;
  readonly sections: readonly OutlineSectionRecord[];
  /**
   * 是否存在人工手改过的段落——`regenerateOutline` 判断要不要走
   * `OUTLINE_OVERWRITE_NEEDS_CONFIRM`（A3）的唯一依据。F84 没有实现逐段编辑
   * （那是 F85 `updateOutlineSection` 的范围）,所以这张表目前只会被这里的
   * `create`/`replaceSections` 写成 `false`；一旦 F85 落地手改路径,它在那里被
   * 置 `true`。
   */
  readonly manuallyEdited: boolean;
}

export interface CreateOutlineInput {
  readonly orgId: OrgId;
  readonly outlineId: string;
  readonly interviewId: string;
  readonly sections: readonly OutlineSectionDraft[];
  readonly generatedBy: string;
}

/**
 * 一行「已从库里取出、但还没对任何人解封」的大纲。
 *
 * 大纲不是独立的可授权对象——它是**这场访谈的一个 facet**，所以 `item` 的 `ref`
 * 复用 `{kind: "interview", id: interviewId}`（与 `pg-interview-scope-repository.ts`
 * 的 `toGuarded` 同一个 ref 身份），`facts` 就是那场访谈自己的可见性事实
 * （`InterviewVisibilityFacts`）。调用方拿这两者去 `decideInterviewVisibility` +
 * `discloseDecided`——与判定这场访谈本身可见性用的是**同一条规则**，不是给
 * 「大纲」另造一套访问控制。
 */
export interface GuardedOutlineRow {
  readonly item: Guarded<OutlineRecord>;
  readonly facts: InterviewVisibilityFacts;
}

export interface OutlineRepository {
  /** 三步向导第三步——首次生成,建一行,状态恒 `pending_confirm`。 */
  create(input: CreateOutlineInput): Promise<OutlineRecord>;

  /**
   * 按访谈取当前这一份大纲（一场访谈至多一份,`null` = 尚未生成过）。
   * ⚠ `viewerUserId` 用来在同一条查询里现算 `isExplicitCollaborator`——两次查询
   * 之间协作者被移除，就会出现「按旧事实判定、发新内容」（与 F80 的
   * `pg-interview-scope-repository.ts` 同一条纪律）。
   */
  getByInterview(orgId: OrgId, viewerUserId: string, interviewId: string): Promise<GuardedOutlineRow | null>;

  /**
   * 重新生成——整体替换 `sections`,状态回到 `pending_confirm`。
   * ⚠ 调用方在此之前已经用 `manuallyEdited` 判过要不要弹二次确认（A3);
   * 这个方法本身不做该判断,只管覆盖。
   */
  replaceSections(orgId: OrgId, outlineId: string, sections: readonly OutlineSectionDraft[]): Promise<OutlineRecord>;

  /** 确认——状态转 `confirmed`。之后 `startSession` 才可能放行进现场（I-10）。 */
  confirm(orgId: OrgId, outlineId: string): Promise<OutlineRecord>;

  /**
   * 按 `outlineId` 直读（F85）。⚠ 不做可见性判定——与 `confirm()` 同一立场：
   * 调用方已经持有这个 `outlineId`（从一次已授权的 `getByInterview` 拿到，或它自己就是
   * 发起写操作的研究员），这里只是 org 范围内的一次直查，不是给「大纲」另造一套读路径。
   */
  getById(orgId: OrgId, outlineId: string): Promise<OutlineRecord | null>;

  /**
   * 逐段手改的整体覆盖点（F85 `updateOutlineSection`）。
   *
   * ⚠ 与 `replaceSections`（AI 重新生成）故意分开：`replaceSections` 之后
   *   `manuallyEdited` 恒 `false`（那是一次全新生成）；这个方法之后 `manuallyEdited`
   *   恒 `true`（这是人工改的），且若原状态是 `confirmed`，编辑会把它**打回
   *   `pending_confirm`**——手改之后必须重新确认一次，不能让「改了但没人确认过」的
   *   内容继续顶着 `confirmed` 的名义进现场。
   */
  updateSections(
    orgId: OrgId,
    outlineId: string,
    sections: readonly OutlineSectionDraft[],
  ): Promise<OutlineRecord>;
}

export const OUTLINE_REPOSITORY = Symbol("OutlineRepository");

export interface CreateBlankInterviewInput {
  readonly orgId: OrgId;
  readonly interviewId: string;
  readonly projectId: string | null;
  readonly researchProjectId: string | null;
  readonly sourceKind: InterviewSourceKindName;
  readonly title: string;
  readonly createdBy: string;
}

/**
 * 「不用模板,从空白开始」（A2）新建一场访谈的写入端口。
 *
 * ⚠ 只建**身份行**（`interview_sessions`）,不建模板套用记录——这正是它与
 * `TemplateRepository.apply()` 的分界:那边多写一行 `interview_template_applications`,
 * 这边压根没有模板可套。
 */
export interface WizardInterviewRepository {
  createBlankInterview(input: CreateBlankInterviewInput): Promise<{ readonly interviewId: string }>;
}

export const WIZARD_INTERVIEW_REPOSITORY = Symbol("WizardInterviewRepository");
