/**
 * `revertThemeOperation` —— 兑现 `mergeThemes`/`splitThemes`/`adjustEvidenceWeight`
 * 返回的 `revertToken`（F04 notes「revertToken 持久化回滚」）。
 *
 * ⚠ 契约 `interview.ts` 尚未为"回滚"声明专门的 HTTP 操作（`theme-ports.ts` 头注、
 *   `ThemeRevertTokenInvalidError` 头注已如实登记）——本函数是 F04 交付的"可回滚"能力
 *   在 application 层的落点，供未来补出对应契约操作时直接接线，也供本 feature 自己的
 *   real-db 测试在仓储/应用层直接验证回滚语义。
 */
import type { OrgId } from "../../domain/org-id";
import { ThemeRevertTokenInvalidError } from "./errors";
import type { RevertedOperationKind, ThemeRepository } from "./theme-ports";

export interface RevertThemeOperationDeps {
  readonly themes: ThemeRepository;
}

export interface RevertThemeOperationInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly revertToken: string;
}

export async function revertThemeOperation(
  deps: RevertThemeOperationDeps,
  input: RevertThemeOperationInput,
): Promise<{ readonly kind: RevertedOperationKind }> {
  const result = await deps.themes.revert(input.orgId, input.actorId, input.revertToken);
  if (result === null) throw new ThemeRevertTokenInvalidError(input.revertToken);
  return result;
}
