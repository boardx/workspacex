/**
 * `updateTemplate` —— 编辑模板（uc-6-1 A2 / I-9）。
 *
 * ⚠ **产生新版本，不改旧行**：旧版本号已经被某些访谈的 `applied_template_version_id`
 * 引用着（或者哪怕现在还没有，将来也可能有），改旧行内容会让那些引用悄悄跟着变——
 * 那正是「套用即脱钩」要防的事。所以这里没有 `UPDATE ... SET sections = ...`，
 * 只有插入一条新版本行 + 把 `current_version_id` 前移。数据库侧的
 * `interview_template_version_immutable` 触发器是这条规则的第二道门（在用例判断之外）。
 *
 * 并发：`expectedVersionNumber` 与当前 head 不一致 ⇒ `TEMPLATE_VERSION_CHANGED`
 * （乐观并发，uc-6-1/E3——同一模板被两人同时改，后到的那个必须先看最新版再决定覆盖还是合并）。
 */
import type { IdFactory } from "../artifact/ports";
import { computeTemplateVersionHash } from "../../domain/interview/template";
import type { OrgId } from "../../domain/org-id";
import type {
  TemplateFieldInput,
  TemplateSectionInput,
} from "../../domain/interview/template";
import { TemplateVersionChangedError } from "./errors";
import type { TemplateRepository, TemplateVersionRecord } from "./template-ports";

export interface UpdateTemplateDeps {
  readonly repo: TemplateRepository;
  readonly ids: IdFactory;
}

export interface UpdateTemplateDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly templateId: string;
  readonly expectedVersionNumber: number;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
}

export async function updateTemplate(
  deps: UpdateTemplateDeps,
  input: UpdateTemplateDto,
): Promise<TemplateVersionRecord> {
  const contentHash = computeTemplateVersionHash({
    name: input.name,
    goal: input.goal,
    sections: input.sections,
    dataFields: input.dataFields,
    tags: input.tags,
  });

  // 来源链（F83：反向抽取入库时钉下的 sourceInterviewIds）跟着模板走，编辑不应该
  // 把它清空——从当前 head 读出来原样带过去，而不是让 repo 默认成空数组。
  const currentHead = await deps.repo.getHead(input.orgId, input.templateId);

  const written = await deps.repo.update({
    orgId: input.orgId,
    templateId: input.templateId,
    versionId: deps.ids.next("tplv"),
    actorId: input.actorId,
    expectedVersionNumber: input.expectedVersionNumber,
    name: input.name,
    goal: input.goal,
    sections: input.sections,
    dataFields: input.dataFields,
    tags: input.tags,
    contentHash,
    sourceInterviewIds: currentHead?.sourceInterviewIds ?? [],
  });

  if (written === null) {
    const head = await deps.repo.getHead(input.orgId, input.templateId);
    throw new TemplateVersionChangedError(
      input.templateId,
      input.expectedVersionNumber,
      head?.versionNumber ?? -1,
    );
  }

  return written;
}
