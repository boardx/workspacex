/**
 * 发新版本的**唯一写入口**（F66；UC-3.4 R3 分支 A）。
 *
 * ## 改名留痕：`publishNewVersion` → `releaseSkillVersion`（2026-08-05，#459）
 *
 * 本文件曾叫 `publish-new-version.ts` / `publishNewVersion`，与契约
 * `packages/contracts/src/skills.ts:828` 的 `publishNewVersion` **同名不同义**：
 *
 * | | 入参 | 语义 |
 * |---|---|---|
 * | 契约 `publishNewVersion` | `{skillId, contract, expectedHeadVersion, schemaBreakingAck}` | **新建一个版本草稿** |
 * | 本文件（改名前） | `{skillId, versionId, expectedHeadVersionId}`，调 `releaseVersion()` | **发布 / 放行一个已存在的版本** |
 *
 * 同名不同义是最贵的一类漂移——读代码的人不会去查两边入参，会直接假设它们是一件事。
 * 按 ADR-020（契约先行，契约是唯一事实源）与 coord-main 在 #459 的裁决：
 * **契约的名字赢**，`publishNewVersion` 这个名字留给契约那个语义去实现；
 * 本用例改叫 `releaseSkillVersion`，与它实际调用的 `releaseVersion()` 对齐。
 *
 * ⚠ `domain/templates/*` 与 `domain/canvas/*` 里也各有一个 `publishNewVersion`，
 *   **没有一起改**：那两个属于别的契约束（蓝本 / 画布模板），与本束的契约不同名冲突，
 *   顺手改它们就越出了 #459 的范围（AGENTS.md「范围纪律」）。
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

export interface ReleaseSkillVersionInput {
  readonly skillId: string;
  readonly versionId: string;
  /** 调用方读到的「当前生效版本」id；`null` 表示调用方认为此刻还没有生效版本。 */
  readonly expectedHeadVersionId: string | null;
}

export type ReleaseSkillVersionResult =
  | { readonly ok: true; readonly released: SkillVersionSnapshot; readonly archivedVersionId: string | null }
  | { readonly ok: false; readonly code: SkillErrorCode };

export async function releaseSkillVersion(
  input: ReleaseSkillVersionInput,
  deps: { readonly versions: SkillVersionStorePort },
): Promise<ReleaseSkillVersionResult> {
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
