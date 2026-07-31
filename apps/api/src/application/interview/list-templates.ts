/**
 * `listTemplates` —— 模板库列表（uc-6-1 R3 步骤0 / AC2）。
 *
 * 五要素：名称 / 用过N次 / 一句话 / 题数 / 时长区间。`usedCount` 在仓储的同一次查询里
 * 现查（COUNT over `interview_template_applications`），不是把行取回来再在进程内累加——
 * 与 F80 的 `counts` 同一条纪律：统计值不能依赖调用方把全量取全。
 */
import type { OrgId } from "../../domain/org-id";
import type { TemplateRepository, TemplateRowRecord } from "./template-ports";

export interface ListTemplatesDeps {
  readonly repo: TemplateRepository;
}

export async function listTemplates(
  deps: ListTemplatesDeps,
  orgId: OrgId,
): Promise<readonly TemplateRowRecord[]> {
  return deps.repo.list(orgId);
}
