/**
 * 项目中枢 B2-S1（#4425）—— 项目资源关联的仓储端口。
 *
 * 一个端口装四件事（读聚合 / 归属校验 / 挂 / 解挂），不拆成两个：它们对着同一张链接表
 * `project_resource_links` 和同一组资源表，拆开只会让「归属校验」这条谓词长出第二份副本。
 *
 * 读侧返回 `Guarded<T>`：内容（各资源的标题/状态）只有在用例拿到 `authorize()` 的决策之后
 * 才能 `discloseDecided()` 出来——同 `knowledge-graph/read-project-knowledge.ts` 的形状。
 */
import { project as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export const PROJECT_RESOURCE_REPOSITORY = Symbol("ProjectResourceRepository");

export type ProjectResourceKind = z.infer<typeof C.ProjectResourceKind>;
export type ProjectLinkableResourceKind = z.infer<typeof C.ProjectLinkableResourceKind>;

/** 与契约 `ProjectResourceItem` 同形；`linkedAt` 对没有链接行的访谈（在项目里新建）取其自身 `created_at`。 */
export interface ProjectResourceRow {
  readonly kind: ProjectResourceKind;
  readonly id: string;
  readonly title: string;
  readonly ownerUserId: string;
  readonly status: string | null;
  readonly updatedAt: string;
  readonly linkedAt: string;
}

export type LinkResourceOutcome =
  | { readonly kind: "linked" }
  | { readonly kind: "already-linked" }
  /** 容器不存在（或不在这个组织）。用例把它映成 NO_PROJECT_ROLE——与「没有角色」不可分辨。 */
  | { readonly kind: "project-not-found" };

export interface ProjectResourcePort {
  /**
   * 一个项目的全部资源（#4615 起六类：链接表 + 访谈既有的 `project_id`），一次查询。
   * `null` = 容器不存在（或不在这个组织）；`[]` = 存在但一个资源都没挂。
   */
  listProjectResources(orgId: OrgId, projectId: string): Promise<Guarded<readonly ProjectResourceRow[] | null>>;
  /**
   * 资源存在且 `ownerUserId` 是它的所有者。「不存在」与「不是你的」同一个 `false`——
   * 契约 `RESOURCE_NOT_FOUND` 的注释逐字：不泄露别人资源的存在性。
   */
  isOwnedResource(orgId: OrgId, kind: ProjectLinkableResourceKind, resourceId: string, ownerUserId: string): Promise<boolean>;
  /** 幂等：已挂在**这个**项目上 ⇒ `already-linked`；挂在别的项目上 ⇒ 改挂到这里（`linked`）。 */
  linkResource(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly kind: ProjectLinkableResourceKind;
    readonly resourceId: string;
    readonly linkedBy: string;
  }): Promise<LinkResourceOutcome>;
  /** 返回是否真的删掉了一行（没挂在这个项目上 ⇒ `false`）。 */
  unlinkResource(orgId: OrgId, projectId: string, kind: ProjectLinkableResourceKind, resourceId: string): Promise<boolean>;
}
