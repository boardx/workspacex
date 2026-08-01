/**
 * Ports for反向抽取草案（F83，uc-6-1 A3）。
 *
 * 与 `template-ports.ts` 分开成独立文件：草案是一条完全不同的写路径（不可变套用记录
 * 之外的第四张表），且它的读端口（`SourceInterviewReader`）与模板仓储的读写职责不同——
 * 一个是「读若干场来源访谈的抽取素材」，一个是「读写模板本身」。混进同一个接口会让
 * `TemplateRepository` 背上一个与「模板」这个聚合根无关的职责。
 */
import type { OrgId } from "../../domain/org-id";
import type { TemplateFieldInput, TemplateSectionInput } from "../../domain/interview/template";

/**
 * 某一个 `sourceInterviewId` 的抽取素材，**只在调用方已经判过「这个人能看见这场访谈」
 * 之后才会被读**（`extractTemplateDraft` 用例先经 `InterviewScopeRepository` +
 * `decideInterviewVisibility` 判过一遍，见该用例文件头）——这里因此**没有** `accessible`
 * 字段：可访问性不是这一层的判断，混进来会变成第二道、未经审计的可见性门。
 *
 * `aiAnalysisAllowed = false` ⇒ 该场访谈至少一位受访者明确拒绝了 `ai_analysis`（O-05）——
 * 该场**不进抽取输入**，但不算错误：会被静默排除在合并素材之外（domain 层
 * `mergeTemplateDraftContent` 只收 `aiAnalysisAllowed = true` 的场次）。
 */
export interface SourceInterviewMaterialLookup {
  readonly interviewId: string;
  readonly aiAnalysisAllowed: boolean;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
}

export interface TemplateDraftSourceReader {
  /**
   * 按输入顺序逐一给出每个来源 id 的素材；不做去重、不做筛选——那是用例的事。
   * ⚠ 调用方必须只传已经通过可见性判定的 id（见接口文档），这里不重复判一遍。
   */
  readSourceMaterials(
    orgId: OrgId,
    sourceInterviewIds: readonly string[],
  ): Promise<readonly SourceInterviewMaterialLookup[]>;
}

export interface TemplateDraftRecord {
  readonly draftId: string;
  readonly orgId: OrgId;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
  /** 实际进入草案的来源（已按 O-05 过滤过），供详情页可追溯展示。 */
  readonly sourceInterviewIds: readonly string[];
  readonly confirmedTemplateId: string | null;
}

export interface SaveTemplateDraftInput {
  readonly draftId: string;
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly sourceInterviewIds: readonly string[];
}

export interface TemplateDraftStore {
  /** 存草案（未入库状态，`confirmedTemplateId = null`）。 */
  save(input: SaveTemplateDraftInput): Promise<TemplateDraftRecord>;

  /** 取草案；不存在 ⇒ `null`（调用方据此判 `TEMPLATE_DRAFT_NOT_CONFIRMED`）。 */
  get(orgId: OrgId, draftId: string): Promise<TemplateDraftRecord | null>;

  /**
   * 标记该草案已确认入库，指向新建出来的模板。**一次性**：已经带
   * `confirmedTemplateId` 的草案不能再被标记（草案确认不可重放成两个模板）。
   */
  markConfirmed(orgId: OrgId, draftId: string, templateId: string): Promise<void>;
}

export const TEMPLATE_DRAFT_STORE = Symbol("TemplateDraftStore");
export const TEMPLATE_DRAFT_SOURCE_READER = Symbol("TemplateDraftSourceReader");
