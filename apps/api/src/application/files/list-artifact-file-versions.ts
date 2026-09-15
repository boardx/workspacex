/**
 * `listArtifactFileVersions` —— 契约 `files.operations.listVersions`
 * （`GET /artifacts/:artifactId/file-versions`）的应用层。
 *
 * ## 为什么是现在才接，以及接的是哪一条可见性
 *
 * 这条路由在 `files` 契约里签了很久却一直没有控制器（`apps/web/lib/live-files.ts`
 * 的文件头把这件事登记成了一个已知缺口）。现在有了真实需求：`landAsArtifact` 可以
 * 往**同一份 artifact** 上追加版本了，于是「这张图有几版、分别是什么时候存的」
 * 第一次成为一个用户看得见的问题。
 *
 * 可见性**委托给 `chat` 束既有的 `resolveVisibility`**，不新造第二套判定——同
 * `artifacts-steering/read-artifact.ts` 的先例（「Artifact/run 可见性判定 → 上游
 * chat/identity 束」）。定位链是：artifactId → `chat_artifact_landings` 最新一行 →
 * 该行的 `messageId` → `findMessageLocation` 给出 threadId/projectId → 判权。
 *
 * ⚠ **只覆盖「在 chat 里落地过的 artifact」**，这是本函数的诚实边界，不是遗漏：
 *   文件浏览器上传的 artifact 没有 landing 行，这里一律 `ARTIFACT_NOT_FOUND`。
 *   给它们接版本列表要走 `wsx_visible_artifacts()` 那条项目角色判权链
 *   （`files/deliver-artifact.ts`），那是另一件事、另一套判权，混在一个函数里会
 *   让「这次是按哪条规则放行的」不可读。等真有那个需求时在这里加一条显式分支。
 *
 * ⚠ 不可见与不存在**同一个出口**（I-3 / N-25）：本函数只抛
 *   `ArtifactFileVersionsNotFoundError` 一种错误，控制器把它译成裸 404。
 */
import type { OrgId } from "../../domain/org-id";
import type { ArtifactRepository, VersionListEntry } from "../artifact/ports";
import type { ArtifactLandingRepository } from "../chat/artifact-landing-ports";
import type { ChatRepository } from "../chat/ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";

/** 契约 `ARTIFACT_NOT_FOUND`。不可见也走这一个——见文件头。 */
export class ArtifactFileVersionsNotFoundError extends Error {
  constructor() {
    super("artifact_not_found");
  }
}

export interface ListArtifactFileVersionsDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly landings: ArtifactLandingRepository;
  readonly artifacts: ArtifactRepository;
}

export interface ListArtifactFileVersionsInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
}

/**
 * 契约 `listVersions.out.versions[]` 的逐字形状。
 *
 * `downloadable` 恒 `true` 不是这里编的：契约把它写成 `z.literal(true)`
 * （I-1/I-2「旧版永远可下载」的接口投影），所以这里没有一个可能与 schema 打架的
 * 布尔字段，只有一个常量。
 */
export interface ArtifactFileVersionItem {
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly creator: {
    readonly type: "user" | "agent";
    readonly id: string;
    readonly agentRunId: string | null;
  };
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly changeSource: "upload" | "materialize" | "rerun";
  readonly downloadable: true;
}

export interface ListArtifactFileVersionsResult {
  readonly versions: readonly ArtifactFileVersionItem[];
}

export async function listArtifactFileVersions(
  deps: ListArtifactFileVersionsDeps,
  input: ListArtifactFileVersionsInput,
): Promise<ListArtifactFileVersionsResult> {
  const { userId, orgId, artifactId } = input;

  const landing = await deps.landings.findByArtifactId(orgId, artifactId);
  if (landing === null) throw new ArtifactFileVersionsNotFoundError();

  // I-36：他人的草稿对本人不存在。与下面的判权分开写，因为它判的不是「这条线程能不能
  // 看」，而是「这份草稿是不是你的」——`resolveVisibility` 不知道 draft 这件事。
  if (landing.mode === "draft" && landing.createdBy !== userId) {
    throw new ArtifactFileVersionsNotFoundError();
  }

  // projectId 从落地来源消息上取（同 `land-as-artifact.ts` 的第一步）——landing 行
  // 自己不带 projectId，而 `resolveVisibility` 靠 `projectId === null` 分派个人线程
  // 与项目线程两条判权分支。
  const location = await deps.chat.findMessageLocation(orgId, landing.messageId);
  if (location === null || location.threadId !== landing.threadId) {
    throw new ArtifactFileVersionsNotFoundError();
  }

  const outcome = await resolveVisibility(deps, {
    userId,
    orgId,
    projectId: location.projectId,
    threadId: landing.threadId,
  });
  if (outcome.kind !== "allow") throw new ArtifactFileVersionsNotFoundError();

  const rows = await deps.artifacts.listVersions(orgId, artifactId);
  return { versions: rows.map(toItem) };
}

function toItem(row: VersionListEntry): ArtifactFileVersionItem {
  return {
    versionNumber: row.versionNumber,
    createdAt: row.createdAt,
    creator: row.creator,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    changeSource: row.changeSource,
    downloadable: true,
  };
}
