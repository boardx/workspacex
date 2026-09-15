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
  /**
   * 落地来源消息（`chat_artifact_landings.message_id`，NOT NULL 列的直读投影）。
   * design-delta chat-persona-roundtrip G1a（confirmed 2026-08-18）：前端靠它把
   * 「本消息的最新保存版」关联起来，签核裁严格 string，不留 nullable 预留。
   */
  readonly messageId: string;
}

export interface ListThreadArtifactsDeps extends ResolveVisibilityDeps {
  readonly landings: ArtifactLandingRepository;
}

export interface ListThreadArtifactsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /**
   * `null` = 个人线程（人类裁决，2026-08-21）——`resolveVisibility` 按
   * `projectId === null` 分派到 `resolvePersonalVisibility`（同 `landAsArtifact`
   * 同一条分派规则，不是这里新发明的）。控制器把缺失的 query 参数归一成 `null`，
   * 不是 `undefined`——`undefined` 在 `resolveVisibility` 眼里会被误判成"项目
   * 线程但没传 projectId"，走错分支。
   */
  readonly projectId: string | null;
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
  const visible = rows
    // I-36：草稿仅创建者可见，包括对创建者以外的项目管理员/组织管理员——这里没有
    // "管理员例外"分支，是刻意的（草稿的仅创建者可见没有角色例外）。
    .filter((r) => r.mode !== "draft" || r.createdBy === userId);

  // 一个 artifactId 一行。
  //
  // `landAsArtifact` 现在可以带 `artifactId` 把一次保存写成**同一份 artifact 的下一个
  // 版本**（同一个 artifactId 因此会有多条 landing 行）。那是同一份产物的版本线，不是
  // 多份产物——列表里排成 N 行会让「右栏产物」读起来像用户存了 N 份不同的东西。
  //
  // ⚠ 对本字段存在之前落下的数据这是**恒等变换**：那时每次落地都是一份新 artifact，
  //   每个 artifactId 恰好一行，去重摘不掉任何一行，`version` 也还是 1。
  //   行内取**最新**一条（`listByThread` 按 created_at 升序，后来者覆盖）。
  const latestByArtifact = new Map<string, (typeof visible)[number]>();
  const versionCount = new Map<string, number>();
  for (const r of visible) {
    latestByArtifact.set(r.artifactId, r);
    versionCount.set(r.artifactId, (versionCount.get(r.artifactId) ?? 0) + 1);
  }

  const items = [...latestByArtifact.values()].map((r) => ({
    artifactId: r.artifactId,
    title: r.title,
    mode: r.mode,
    // 只有 pinned 才有一个恒为正数的版本号 = 这份 artifact 上的落地次数（每次落地
    // 恰好产生一个版本，见 `land-as-artifact.ts`）。只落地过一次时是 1，与本行为
    // 存在之前逐字相同。
    version: r.mode === "pinned" ? (versionCount.get(r.artifactId) ?? 1) : null,
    pinnedBy: r.mode === "pinned" ? r.createdBy : null,
    pinnedAt: r.mode === "pinned" ? r.createdAt : null,
    hasSource: r.hasSource,
    messageId: r.messageId,
  }));

  return { items };
}
