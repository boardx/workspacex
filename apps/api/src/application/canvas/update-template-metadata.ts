/**
 * `updateTemplateMetadata` —— 原地改写 `displayName`/`tags`，任意状态均可（2026-08-25，
 * R2，设计增量，待人类补签，先例见 `packages/contracts/src/canvas.ts` 该操作文件头）。
 *
 * 与 `updateTemplateDraft` 同一个判定函数（`requireTemplateAdmin`），但**不**限定
 * `status === 'draft'`——改名字/标签不算"改内容"，`sections` 不在入参里，物理上
 * 不可能被本用例触碰。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type {
  CanvasTemplateRepository,
  UpdatedCanvasTemplateMetadata,
} from "./template-ports";

export interface UpdateTemplateMetadataDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface UpdateTemplateMetadataInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly version: number;
  readonly displayName: string;
  readonly tags?: readonly string[];
  /**
   * 版面装帧。⚠ 省略与空串在这里**同义**，都表示"不画那一带"——但两者在 HTTP 上是
   * 不同的请求体，所以归一必须发生在这一层，仓储永远收到真字符串。同 `tags` 的
   * `?? []`：让仓储去判 undefined 就等于把同一件事在两处各判一遍。
   */
  readonly title?: string;
  readonly footer?: string;
  readonly promptText?: string;
}

export async function updateTemplateMetadata(
  deps: UpdateTemplateMetadataDeps,
  input: UpdateTemplateMetadataInput,
): Promise<UpdatedCanvasTemplateMetadata> {
  // 与其余 canvas 模板写操作同一个判定函数——见 `template-admin.ts` 文件头。
  await requireTemplateAdmin({ identity: deps.identity }, input);

  const outcome = await deps.templates.updateMetadata({
    orgId: input.orgId,
    key: input.key,
    version: input.version,
    displayName: input.displayName,
    tags: input.tags ?? [],
    title: input.title ?? "",
    footer: input.footer ?? "",
    promptText: input.promptText ?? "",
  });

  if (!outcome.updated) {
    throw new CanvasError("TEMPLATE_NOT_FOUND");
  }
  return outcome.template;
}
