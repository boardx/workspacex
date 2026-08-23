/**
 * `updateTemplateDraft` —— 原地改写一个仍是 `draft` 的版本（2026-08-23，设计增量，
 * 待人类补签，先例见 `packages/contracts/src/canvas.ts` 该操作文件头）。
 *
 * 与 `createTemplate` 同一个判定函数（`requireTemplateAdmin`），全量替换
 * `displayName`/`sections`/`visibility` 三栏——不做 patch，理由见契约文件头。
 */
import type { OrgId } from "../../domain/org-id";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type {
  CanvasTemplateRepository,
  CreatedCanvasTemplate,
  UpdatedCanvasTemplateDraft,
} from "./template-ports";

export interface UpdateTemplateDraftDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface UpdateTemplateDraftInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
  readonly displayName: string;
  readonly sections: CreatedCanvasTemplate["sections"];
  readonly visibility: VisibilityScope;
}

export async function updateTemplateDraft(
  deps: UpdateTemplateDraftDeps,
  input: UpdateTemplateDraftInput,
): Promise<UpdatedCanvasTemplateDraft> {
  // 与其余 canvas 模板写操作同一个判定函数——见 `template-admin.ts` 文件头。
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const outcome = await deps.templates.updateDraft({
    orgId: input.orgId,
    key: input.key,
    version: input.version,
    displayName: input.displayName,
    sections: input.sections,
    visibility: input.visibility,
  });

  if (!outcome.updated) {
    throw new CanvasError(outcome.reason === "not-found" ? "TEMPLATE_NOT_FOUND" : "TEMPLATE_NOT_DRAFT");
  }
  return outcome.template;
}
