/**
 * `getThreadArtifactSource` —— 取回一次落地的源 markdown，供图表 modal 重开时用
 * 最新保存版初始化（design-delta chat-persona-roundtrip G1b，confirmed 2026-08-18；
 * 契约见 `packages/contracts/src/chat.ts` 的同名操作）。
 *
 * ⚠ **草稿仅创建者可见 → 其余 NOT_VISIBLE**（I-36 的同一形状）：与 `listThreadArtifacts`
 *   的隐藏语义一致——同一条草稿在 list 里不可见 ∧ source 读不到，两处一致；
 *   「不存在」与「不可见」同一个出口，不给探测留缝（I-3）。
 * ⚠ **只读端口，不新起版本机制**（D-38 延续）：markdown 从 phase-00 `materializeArtifact`
 *   已写下的字节读回（`storageKey` 是那次写入用的同一把 key 函数，不是第二份路径拼写），
 *   本函数不写任何东西。
 * ⚠ `STORAGE_UNAVAILABLE`：字节在对象存储，读不到（key 缺失或存储抛错）是真实失败面
 *   ——landing 行存在但字节读不回来，如实报 503，不佯装「没有保存版」。
 */
import type { OrgId } from "../../domain/org-id";
import { storageKey } from "../../domain/artifact/materialization";
import type { ArtifactRepository, ObjectStore } from "../artifact/ports";
import type { ArtifactLandingRepository } from "./artifact-landing-ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";

export class ArtifactSourceStorageUnavailableError extends Error {}

export interface GetThreadArtifactSourceDeps extends ResolveVisibilityDeps {
  readonly landings: ArtifactLandingRepository;
  readonly artifacts: ArtifactRepository;
  readonly store: ObjectStore;
}

export interface GetThreadArtifactSourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /** `null` = 个人线程（人类裁决，2026-08-21）——见 `list-thread-artifacts.ts` 同名字段注释。 */
  readonly projectId: string | null;
  readonly threadId: string;
  readonly artifactId: string;
}

export interface GetThreadArtifactSourceResult {
  readonly markdown: string;
  readonly version: number | null;
  readonly savedAt: string;
  readonly savedBy: string;
}

export async function getThreadArtifactSource(
  deps: GetThreadArtifactSourceDeps,
  input: GetThreadArtifactSourceInput,
): Promise<GetThreadArtifactSourceResult> {
  const { userId, orgId, projectId, threadId, artifactId } = input;

  const outcome = await resolveVisibility(deps, { userId, orgId, projectId, threadId });
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  const landing = await deps.landings.findLatestByThreadAndArtifact(orgId, threadId, artifactId);
  if (landing === null) throw new ThreadNotVisibleError();
  // I-36：草稿仅创建者可见——包括对项目/组织管理员，没有角色例外
  // （与 `list-thread-artifacts.ts` 的过滤逐字同一条规则）。
  if (landing.mode === "draft" && landing.createdBy !== userId) {
    throw new ThreadNotVisibleError();
  }

  // 每次落地都是一份新 artifact（`land-as-artifact.ts` 文件头），版本号照理恒为 1；
  // 仍从版本表读 head 而不写死 1——写死是第二份「版本怎么编号」的声明。
  let markdown: string;
  try {
    const versionNumber = await deps.artifacts.headVersionNumber(orgId, artifactId);
    const bytes = await deps.store.get(
      storageKey({ orgId, artifactId, versionNumber, fileName: "content.md" }),
    );
    if (bytes === null) throw new ArtifactSourceStorageUnavailableError("content.md missing");
    markdown = new TextDecoder().decode(bytes);
  } catch (e) {
    if (e instanceof ArtifactSourceStorageUnavailableError) throw e;
    throw new ArtifactSourceStorageUnavailableError(e instanceof Error ? e.message : String(e));
  }

  return {
    markdown,
    // 与 `listThreadArtifacts` 同义：只有 pinned 有恒为正数的版本号，draft ⇒ null。
    version: landing.mode === "pinned" ? 1 : null,
    savedAt: landing.createdAt,
    savedBy: landing.createdBy,
  };
}
