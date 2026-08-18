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
  /**
   * F155 L3 —— 落地内容的**有界摘录**（= 写进对象存储那份 `content.md` 的前 N 字，
   * N 见 `application/agent-run/file-retrieval.ts` 的 `LANDED_CONTENT_EXCERPT_MAX_CHARS`）。
   *
   * ⚠ 这**不是**在落地记录里存第二份正文：字节本体与版本血缘仍全部在 phase-00 artifact
   * （本文件头注那条纪律不变）。存这一段的唯一目的是让 `chat_artifact_landings.search_tsv`
   * 这个生成列有正文可索引——delta §4：「落地即可检索，不需要用户额外操作」。要让全文检索
   * 每次都去对象存储把 `content.md` 拉回来，就等于没有索引。
   */
  readonly contentExcerpt: string;
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

  /**
   * `getThreadArtifactSource`（design-delta chat-persona-roundtrip G1b）：某次落地的
   * landing 行。签核：同一 `(threadId, artifactId)` 理论上只有一行（每次落地都是新
   * artifact），但契约层防御性地约定「若有多行取 `created_at` 最新一条」——排序落在
   * SQL 里，不在调用方。未经 I-36 的草稿过滤（那是 application 层的事）。
   */
  findLatestByThreadAndArtifact(
    orgId: OrgId,
    threadId: string,
    artifactId: string,
  ): Promise<ArtifactLandingRow | null>;
}

export const ARTIFACT_LANDING_REPOSITORY = Symbol("ArtifactLandingRepository");
