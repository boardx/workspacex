/**
 * 发新版本的**唯一写入口**（F66；UC-3.4 R3 分支 A）。
 *
 * ⚠ 门禁（安全扫描 + 方法论审核、提交人≠审核人）不在这里重做——那是 F62 的范围，
 *   而且已经在 F61/F62 的 `advance-skill-status.ts` / `security-gate.ts` 测过。
 *   本用例假定调用方是**从 `reviewSkillVersion` approve 分支**过来的：
 *   `versionId` 此刻必须是 `待审核`，否则 `releaseVersion` 直接抛错
 *   （见 `version-chain.ts` 的 `VersionChainError`）。
 *
 * ⚠ 并发（E5）：`expectedHeadVersionId` 让两个人同时发新版时后来者拿到明确的
 *   `SKILL_VERSION_CHANGED`，而不是把对方的发布悄悄顶掉——两个人各自算出的
 *   「下一个版本号」在没有这个校验时会撞在同一个号上。
 */
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import { releaseVersion, VersionChainError, type SkillVersionSnapshot } from "../../domain/skill/version-chain";
import type { SkillVersionStorePort } from "./ports";

export interface PublishNewVersionInput {
  readonly skillId: string;
  readonly versionId: string;
  /** 调用方读到的「当前生效版本」id；`null` 表示调用方认为此刻还没有生效版本。 */
  readonly expectedHeadVersionId: string | null;
}

export type PublishNewVersionResult =
  | { readonly ok: true; readonly released: SkillVersionSnapshot; readonly archivedVersionId: string | null }
  | { readonly ok: false; readonly code: SkillErrorCode };

export async function publishNewVersion(
  input: PublishNewVersionInput,
  deps: { readonly versions: SkillVersionStorePort },
): Promise<PublishNewVersionResult> {
  const history = await deps.versions.loadChain(input.skillId);

  const currentHead = history.find((v) => v.state === "已生效")?.versionId ?? null;
  if (currentHead !== input.expectedHeadVersionId) {
    return { ok: false, code: "SKILL_VERSION_CHANGED" };
  }

  try {
    const { history: nextHistory, archivedVersionId } = releaseVersion(history, input.versionId);
    await deps.versions.saveChain(input.skillId, nextHistory);
    const released = nextHistory.find((v) => v.versionId === input.versionId);
    if (released === undefined) {
      // 结构上不可达：`releaseVersion` 成功时目标版本必然还在返回的历史里。
      return { ok: false, code: "SKILL_VERSION_CHANGED" };
    }
    return { ok: true, released, archivedVersionId };
  } catch (e) {
    if (e instanceof VersionChainError) {
      return { ok: false, code: "SKILL_VERSION_CHANGED" };
    }
    throw e;
  }
}
