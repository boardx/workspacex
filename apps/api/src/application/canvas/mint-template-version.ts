/**
 * `mintTemplateVersion` —— 「基于既有模板开新版」，本束「编辑」的真实语义（#988）。
 *
 * ## 已由人类签核（#496 → #988）
 *
 * `packages/contracts/src/canvas.ts` 的 `mintTemplateVersion` 是 2026-08-17 人类在
 * `design-signoff.md` 里签核确认的操作（不是待补签状态）。见该操作文件头的完整背景。
 *
 * ## 与 `createTemplate` 共用判定，不重写一遍
 *
 * 同 `create-template.ts` 那条「不变量写五遍，漏掉的那一遍不会有任何东西报警」的理由，
 * 本用例复用同一个 `requireTemplateAdmin`。
 *
 * ## `ownerTeamId`：解析 + 显式拒绝都在这里，不在契约边界
 *
 * 与 `createTemplate` 一样，今天没有前端团队选择器：`input.ownerTeamId` 几乎总是
 * `undefined`。解析规则——client 显式传了就用 client 的（为将来的团队选择器留口子），
 * 否则取调用者自己的团队（`requireTemplateAdmin` 返回的 `membership.teamId`）。
 *
 * ⚠ 解析之后，`visibility: "team-only"` 且结果仍为空 ⇒ **显式拒绝**
 *   （`TEAM_REQUIRED_FOR_TEAM_ONLY`，C_CANVAS_8① 在本操作的裁决）——这是与
 *   `createTemplate` 唯一的行为差异：`create-template.ts` 在这一步是静默 fail-closed
 *   （建完看不见），本操作是造之前就当场拒绝。两种颗粒度并存于同一个束是签核材料
 *   明确允许的（`design-signoff.md`「人类可以逐件独立勾选签核」）。
 */
import type { OrgId } from "../../domain/org-id";
import type { VisibilityScope } from "../../domain/identity/roles";
import type { IdentityRepository } from "../identity/ports";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import type {
  CanvasTemplateRepository,
  MintedCanvasTemplateVersion,
} from "./template-ports";

export interface MintTemplateVersionDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
}

export interface MintTemplateVersionInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly displayName: string;
  readonly underlyingType: string;
  readonly sections: MintedCanvasTemplateVersion["sections"];
  readonly visibility: VisibilityScope;
  /** 契约 `.strict()` 允许省略；省略与显式 `null` 在这里同义，都不含团队。 */
  readonly ownerTeamId?: string | null | undefined;
  readonly tags?: readonly string[];
}

export async function mintTemplateVersion(
  deps: MintTemplateVersionDeps,
  input: MintTemplateVersionInput,
): Promise<MintedCanvasTemplateVersion> {
  const membership = await requireTemplateAdmin({ identity: deps.identity }, input);

  // client 显式传了就用 client 的（留给未来的团队选择器）；否则取调用者自己的团队——
  // 与 `create-template.ts` 同一个解析顺序，唯一不同的是下面这一步的后果。
  const ownerTeamId = input.ownerTeamId ?? membership.teamId;

  // C_CANVAS_8①：`createTemplate` 在这里是静默 fail-closed（建完看不见）；本操作
  // 升级为显式拒绝——造之前就报，而不是让调用者建完一行谁也看不见的模板才发现。
  if (input.visibility === "team-only" && ownerTeamId === null) {
    throw new CanvasError("TEAM_REQUIRED_FOR_TEAM_ONLY");
  }

  const outcome = await deps.templates.mintVersion({
    orgId: input.orgId,
    key: input.key,
    displayName: input.displayName,
    underlyingType: input.underlyingType,
    sections: input.sections,
    visibility: input.visibility,
    ownerTeamId,
    tags: input.tags ?? [],
  });

  if (!outcome.minted) {
    throw new CanvasError("TEMPLATE_NOT_FOUND");
  }
  return outcome.template;
}
