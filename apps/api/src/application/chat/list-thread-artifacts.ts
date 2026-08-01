/**
 * `listThreadArtifacts` —— UC-22：右栏「产物」列表（F114 · uc-8-3 R5 / I-36 / V7）。
 *
 * ⚠ **草稿仅创建者可见 → 其余 404**（I-36），与其余读路径同一个"不可见与不存在
 * 逐字相同"的出口（I-3）：过滤在这里做（`application` 层），不是发出去再指望前端隐藏。
 * ⚠ 空态返回 `items: []`，不生成伪产出（V7）——这里没有"没有产出时补一条示例行"
 * 的分支，长度为 0 就是长度为 0。
 */
import type { OrgId } from "../../domain/org-id";
import type { LandingModeName } from "../../domain/chat/artifact-landing";
import type { ArtifactLandingRepository } from "./artifact-landing-ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export interface ThreadArtifactItem {
  readonly artifactId: string;
  readonly title: string;
  readonly mode: LandingModeName;
  readonly version: number | null;
  readonly pinnedBy: string | null;
  readonly pinnedAt: string | null;
  readonly hasSource: boolean;
}

export interface ListThreadArtifactsDeps extends ResolveVisibilityDeps {
  readonly landings: ArtifactLandingRepository;
}

export interface ListThreadArtifactsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
}

export interface ListThreadArtifactsResult {
  readonly items: readonly ThreadArtifactItem[];
}

export async function listThreadArtifacts(
  deps: ListThreadArtifactsDeps,
  input: ListThreadArtifactsInput,
): Promise<ListThreadArtifactsResult> {
  const { userId, orgId, projectId, threadId } = input;

  const outcome = await resolveVisibility(deps, { userId, orgId, projectId, threadId });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const rows = await deps.landings.listByThread(orgId, threadId);
  const items = rows
    // I-36：草稿仅创建者可见，包括对创建者以外的项目管理员/组织管理员——这里没有
    // "管理员例外"分支，是刻意的（草稿的仅创建者可见没有角色例外）。
    .filter((r) => r.mode !== "draft" || r.createdBy === userId)
    .map((r) => ({
      artifactId: r.artifactId,
      title: r.title,
      mode: r.mode,
      // 只有 pinned 才有一个恒为正数的版本号；这里用 1 代表本 UC 落地只产生首个
      // 版本（每次落地都是一份新 artifact，见 `land-as-artifact.ts` 文件头）。
      version: r.mode === "pinned" ? 1 : null,
      pinnedBy: r.mode === "pinned" ? r.createdBy : null,
      pinnedAt: r.mode === "pinned" ? r.createdAt : null,
      hasSource: r.hasSource,
    }));

  return { items };
}
