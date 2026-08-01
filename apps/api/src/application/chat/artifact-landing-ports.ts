/**
 * F114 —— 落地记录的存储端口。定义在这里，由 `infrastructure` 实现。
 *
 * 与 `application/artifact/ports.ts` 的关系：那个文件owns 字节与版本血缘
 * （`ArtifactRepository`/`ObjectStore`），这个端口只 own「这次落地选的是哪个模式、
 * 挂没挂来源」——`chat_artifact_landings` 一行不携带任何内容正文，只有指针
 * （`artifactId`/`versionId`）与判定结果（`mode`/`hasSource`）。见迁移文件头
 * 对为什么不复用 `bindToProjectStep` 的登记。
 */
import type { OrgId } from "../../domain/org-id";
import type { LandingModeName } from "../../domain/chat/artifact-landing";

export interface NewArtifactLanding {
  readonly id: string;
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly messageId: string;
  readonly artifactId: string;
  readonly versionId: string | null;
  readonly title: string;
  readonly mode: LandingModeName;
  readonly hasSource: boolean;
  readonly citationCount: number;
  readonly createdBy: string;
}

export interface ArtifactLandingRow {
  readonly id: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly artifactId: string;
  readonly versionId: string | null;
  readonly title: string;
  readonly mode: LandingModeName;
  readonly hasSource: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ArtifactLandingRepository {
  create(row: NewArtifactLanding): Promise<void>;

  /** `checkDownstreamEligibility` 的起点：一个 artifactId 恰好落地过一次（本端口不支持重复落地同一 artifactId，见 F114 应用层）。 */
  findByArtifactId(orgId: OrgId, artifactId: string): Promise<ArtifactLandingRow | null>;

  /** `listThreadArtifacts`（uc-8-3 UC-22）：右栏「产物」列表的全部候选行，未经 I-36 的草稿过滤。 */
  listByThread(orgId: OrgId, threadId: string): Promise<readonly ArtifactLandingRow[]>;
}

export const ARTIFACT_LANDING_REPOSITORY = Symbol("ArtifactLandingRepository");
