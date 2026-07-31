/**
 * Ports for the interview template data model (F82, uc-6-1 B 组).
 *
 * 模板是组织级跨项目资产（domain.md：`projectId` 恒空），本束目前**没有**成员级可见性判断
 * （模板可见范围三档＝[待定 D-16]）；因此这里没有 F80 那套 `Guarded<T>` / `discloseDecided`
 * 机制——不是遗漏，是这个数据模型现在还没有一条需要它去挡的规则。哪天 D-16 落地，
 * 这层端口是加它的地方，而不是现在先造一个不挡任何东西的判定。
 */
import type { OrgId } from "../../domain/org-id";
import type { TemplateFieldInput, TemplateSectionInput } from "../../domain/interview/template";

export interface TemplateVersionRecord {
  readonly templateId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
  readonly contentHash: string;
  readonly sourceInterviewIds: readonly string[];
}

export interface CreateTemplateInput {
  readonly orgId: OrgId;
  readonly templateId: string;
  readonly versionId: string;
  readonly actorId: string;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
  readonly contentHash: string;
}

export interface UpdateTemplateInput {
  readonly orgId: OrgId;
  readonly templateId: string;
  readonly versionId: string;
  readonly actorId: string;
  /** `pre`：调用者声明自己以为的当前 head 版号（乐观并发，uc-6-1/E3）。 */
  readonly expectedVersionNumber: number;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
  readonly contentHash: string;
}

/** 一行「模板库列表」——名称/用过N次/一句话/题数/时长区间 五要素，usedCount 现查得出。 */
export interface TemplateRowRecord {
  readonly templateId: string;
  readonly name: string;
  readonly usedCount: number;
  readonly oneLiner: string;
  readonly questionCount: number;
  readonly minutesRangeMin: number;
  readonly minutesRangeMax: number;
}

export interface ApplyTemplateInput {
  readonly orgId: OrgId;
  readonly templateId: string;
  /** `null` = 套用该模板当前 head 版本。 */
  readonly versionId: string | null;
  /** `null` = 新建一场访谈来套用；非空 = 套到已存在的那一场。 */
  readonly targetInterviewId: string | null;
  readonly newInterviewId: string;
  readonly applicationId: string;
  readonly actorId: string;
}

export interface ApplyTemplateResult {
  readonly interviewId: string;
  readonly appliedTemplateVersionId: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
}

/** 某一场访谈已套用的那份三样东西（脱钩之后的独立副本，不是模板版本的实时投影）。 */
export interface AppliedTemplateSnapshot {
  readonly interviewId: string;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
}

export interface TemplateRepository {
  /** 新建模板 + 第一个版本（同一事务）。 */
  create(input: CreateTemplateInput): Promise<TemplateVersionRecord>;

  /**
   * 编辑 —— 产生新版本，`current_version_id` 前移；旧版本行不改一个字节（A2 / I-9）。
   * `expectedVersionNumber` 与当前 head 不一致 ⇒ `null`（调用方据此抛 `TemplateVersionChangedError`）。
   */
  update(input: UpdateTemplateInput): Promise<TemplateVersionRecord | null>;

  /** 按 id 取模板当前 head 版本；`null` = 不存在（本束暂无可见性判断，见文件头）。 */
  getHead(orgId: OrgId, templateId: string): Promise<TemplateVersionRecord | null>;

  /** 按 (templateId, versionId) 取某一具体版本——`applyTemplate` 指定 `versionId` 时用。 */
  getVersion(orgId: OrgId, templateId: string, versionId: string): Promise<TemplateVersionRecord | null>;

  /** 模板库列表。`usedCount` 在同一次查询里现查（COUNT over 全部版本的套用记录，I-8）。 */
  list(orgId: OrgId): Promise<readonly TemplateRowRecord[]>;

  /** 该模板全部版本的**累计**套用次数（A2：「用过 N 次是该模板全部版本的累计」）。 */
  usedCount(orgId: OrgId, templateId: string): Promise<number>;

  /**
   * 套用：把三样东西写进一份**该访谈自己的**副本（`interview_template_applications`），
   * 并把 `interview_sessions.applied_template_version_id` 固化成这一版（一次性，写后不再改指）。
   * `targetInterviewId` 为 `null` 时先建一场新访谈。
   */
  apply(input: ApplyTemplateInput): Promise<ApplyTemplateResult>;

  /** 某一场访谈已套用的那份副本；未套用过任何模板 ⇒ `null`。供追溯 / 反证用。 */
  getAppliedSnapshot(orgId: OrgId, interviewId: string): Promise<AppliedTemplateSnapshot | null>;
}

export const TEMPLATE_REPOSITORY = Symbol("TemplateRepository");
