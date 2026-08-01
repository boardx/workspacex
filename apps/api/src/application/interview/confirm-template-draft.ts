/**
 * `confirmTemplateDraft` —— 草案经研究员确认后才入库（uc-6-1 A3 / V3）。
 *
 * 入库＝在 `interview_templates`/`interview_template_versions` 里新建一条模板
 * （复用 F82 的 `TemplateRepository.create`，与 `createTemplate` 走同一张表，只是
 * 多带一份 `sourceInterviewIds`），且把这份草案标记为「已确认」防止重放成两个模板。
 */
import type { IdFactory } from "../artifact/ports";
import { computeTemplateVersionHash } from "../../domain/interview/template";
import { applyDraftEdits } from "../../domain/interview/template-draft";
import type { OrgId } from "../../domain/org-id";
import { TemplateDraftNotConfirmedError } from "./errors";
import type { TemplateDraftStore } from "./template-draft-ports";
import type { TemplateRepository, TemplateVersionRecord } from "./template-ports";

export interface ConfirmTemplateDraftDeps {
  readonly store: TemplateDraftStore;
  readonly repo: TemplateRepository;
  readonly ids: IdFactory;
}

export interface ConfirmTemplateDraftDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly draftId: string;
  /** 见 `domain/interview/template-draft.ts` 的 `applyDraftEdits`——JSON 编码的部分覆盖。 */
  readonly edits: string | null;
}

export async function confirmTemplateDraft(
  deps: ConfirmTemplateDraftDeps,
  input: ConfirmTemplateDraftDto,
): Promise<TemplateVersionRecord> {
  const draft = await deps.store.get(input.orgId, input.draftId);
  if (draft === null || draft.confirmedTemplateId !== null) {
    throw new TemplateDraftNotConfirmedError(input.draftId);
  }

  const content = applyDraftEdits(
    {
      name: draft.name,
      goal: draft.goal,
      sections: draft.sections,
      dataFields: draft.dataFields,
      tags: draft.tags,
    },
    input.edits,
  );

  const contentHash = computeTemplateVersionHash(content);

  const created = await deps.repo.create({
    orgId: input.orgId,
    templateId: deps.ids.next("tpl"),
    versionId: deps.ids.next("tplv"),
    actorId: input.actorId,
    name: content.name,
    goal: content.goal,
    sections: content.sections,
    dataFields: content.dataFields,
    tags: content.tags,
    contentHash,
    sourceInterviewIds: draft.sourceInterviewIds,
  });

  await deps.store.markConfirmed(input.orgId, input.draftId, created.templateId);

  return created;
}
