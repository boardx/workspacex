/**
 * `getTemplate` —— 模板详情（uc-6-1 R3 步骤0 / A2）。
 *
 * `usedCount` 现查（`repo.usedCount`），是该模板**全部版本**的累计（A2）。
 * `sourceInterviewIds` 来自 head 版本行的 `source_interview_ids`——本 feature 不实现反向抽取，
 * 恒为空数组；抽取入库（另一个 feature）是唯一的写者。
 */
import type { OrgId } from "../../domain/org-id";
import type { TemplateRepository } from "./template-ports";

export interface GetTemplateDeps {
  readonly repo: TemplateRepository;
}

export interface TemplateDetail {
  readonly templateId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly { name: string; minutes: number; order: number }[];
  readonly dataFields: readonly { fieldId: string; name: string; kind: string; required: boolean }[];
  readonly tags: readonly string[];
  readonly usedCount: number;
  readonly sourceInterviewIds: readonly string[];
}

export async function getTemplate(
  deps: GetTemplateDeps,
  orgId: OrgId,
  templateId: string,
): Promise<TemplateDetail | null> {
  const head = await deps.repo.getHead(orgId, templateId);
  if (head === null) return null;

  const usedCount = await deps.repo.usedCount(orgId, templateId);

  return {
    templateId: head.templateId,
    versionId: head.versionId,
    versionNumber: head.versionNumber,
    name: head.name,
    goal: head.goal,
    sections: head.sections,
    dataFields: head.dataFields,
    tags: head.tags,
    usedCount,
    sourceInterviewIds: head.sourceInterviewIds,
  };
}
