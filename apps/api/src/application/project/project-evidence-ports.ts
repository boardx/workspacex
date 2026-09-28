/**
 * 项目中枢 B3-T1 —— 证据归一化的端口（契约 `projectEvidence`）。
 *
 * 读侧回 `Guarded<T>`：内容只有在用例拿到 `authorize()` 的决策之后才能 `discloseDecided()`——
 * 同 `project-resource-ports.ts`。写侧 `upsertEvidence` 只给入图管线（B3-T2）用：幂等，同一
 * `(orgId, sourceKind, sourceRef)` 只有一行；`revokeBySource` 在源被删 / 撤回时把整批标 `revoked`。
 *
 * B3-T2 的抽取器通过 `listForIngestion` 取「允许进入项目大脑且尚未入图」的证据，允许与否由
 * `project_ai_settings.allowed_sources` 经 `PROJECT_EVIDENCE_TO_AI_SOURCE` 投影判定——判定在用例层，
 * 仓储只按 sourceKind 过滤。
 */
import type { projectEvidence as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export const PROJECT_EVIDENCE_REPOSITORY = Symbol("ProjectEvidenceRepository");

export type ProjectEvidenceSourceKind = z.infer<typeof C.ProjectEvidenceSourceKind>;
export type ProjectEvidenceRow = z.infer<typeof C.ProjectEvidenceItem>;

export interface ProjectEvidenceListFilter {
  readonly sourceKind?: ProjectEvidenceSourceKind;
  readonly includeRevoked?: boolean;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ProjectEvidencePage {
  readonly items: readonly ProjectEvidenceRow[];
  readonly nextCursor: string | null;
  readonly countsBySource: Readonly<Record<ProjectEvidenceSourceKind, number>>;
}

export interface UpsertEvidenceCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly sourceKind: ProjectEvidenceSourceKind;
  readonly resourceId: string;
  readonly sourceRef: string;
  readonly excerpt: string;
  readonly locator: ProjectEvidenceRow["locator"];
  readonly speakerLabel: string | null;
  readonly resourceTitle: string;
}

export interface ProjectEvidencePort {
  /** `null` = 容器不存在（或不在这个组织）；用例映成 NO_PROJECT_ROLE。 */
  list(orgId: OrgId, projectId: string, filter: ProjectEvidenceListFilter): Promise<Guarded<ProjectEvidencePage | null>>;
  /** 不存在 / 不属于该项目 ⇒ `null` 载荷。 */
  find(orgId: OrgId, projectId: string, evidenceId: string): Promise<Guarded<ProjectEvidenceRow | null>>;
  /** 幂等写：返回该单元的 id（已存在则返回既有 id 并刷新 excerpt / locator）。 */
  upsert(cmd: UpsertEvidenceCommand): Promise<{ readonly id: string; readonly created: boolean }>;
  /** 源被删 / 撤回：同源全部单元标 revoked，返回条数。 */
  revokeBySource(orgId: OrgId, sourceKind: ProjectEvidenceSourceKind, resourceId: string): Promise<number>;
  /**
   * B3-T2 入图取数：某项目、给定来源集合里、尚未被任何结论引用且未撤回的证据，按建立时间升序，最多 `limit` 条。
   * 内容进模型不经人眼，但仍是租户数据——同样 Guarded，由入图用例以项目主体身份判权后披露。
   */
  listForIngestion(orgId: OrgId, projectId: string, sourceKinds: readonly ProjectEvidenceSourceKind[], limit: number): Promise<Guarded<readonly ProjectEvidenceRow[]>>;
}
