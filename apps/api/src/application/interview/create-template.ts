/**
 * `createTemplate` —— 新建访谈模板（uc-6-1 R3 步骤1-3）。
 *
 * 模板决定三样，缺一不可（R7 原文）：① 提纲结构 ② 每段时长 ③ 要收集的数据字段。
 * 契约的 `.strict()` schema 已经保证入参**没有** `usedCount` 这个键——所以这个用例
 * 不需要（也没有资格）判断「调用方是不是想写统计值」，那个问题在类型层面之前就已经不存在。
 */
import type { IdFactory } from "../artifact/ports";
import { computeTemplateVersionHash } from "../../domain/interview/template";
import type { OrgId } from "../../domain/org-id";
import type {
  TemplateFieldInput,
  TemplateSectionInput,
} from "../../domain/interview/template";
import type { TemplateRepository, TemplateVersionRecord } from "./template-ports";

export interface CreateTemplateDeps {
  readonly repo: TemplateRepository;
  readonly ids: IdFactory;
}

export interface CreateTemplateDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly name: string;
  readonly goal: string;
  readonly sections: readonly TemplateSectionInput[];
  readonly dataFields: readonly TemplateFieldInput[];
  readonly tags: readonly string[];
}

export async function createTemplate(
  deps: CreateTemplateDeps,
  input: CreateTemplateDto,
): Promise<TemplateVersionRecord> {
  const contentHash = computeTemplateVersionHash({
    name: input.name,
    goal: input.goal,
    sections: input.sections,
    dataFields: input.dataFields,
    tags: input.tags,
  });

  return deps.repo.create({
    orgId: input.orgId,
    templateId: deps.ids.next("tpl"),
    versionId: deps.ids.next("tplv"),
    actorId: input.actorId,
    name: input.name,
    goal: input.goal,
    sections: input.sections,
    dataFields: input.dataFields,
    tags: input.tags,
    contentHash,
  });
}
