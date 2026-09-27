/**
 * 项目中枢 B2-S5（#4429）—— 设置页「AI 权限」的仓储口：哪些来源允许进入项目大脑。
 *
 * 独立文件、独立 provider（同 `retention-policy-ports.ts` / `PROJECT_TAGS_REPOSITORY` 的做法）：
 * 侧表 `project_ai_settings` 一个项目至多一行，**没有行不是错误**——用例把它读成「默认全部允许」，
 * 仓储不替用例编一行默认值出来（那会让「谁在什么时候设过」这个事实消失）。
 *
 * ## 为什么 `find` 回 `Guarded<…>` 而 `upsert` 回裸行
 *
 *   · 读：这是一次向人披露租户数据的读路径，走 `permission-filter` 的正门——用例拿
 *     `authorize(read.published)` 的决策去 `discloseDecided`，忘了判权就是类型错误。
 *   · 写：返回值是**调用者自己刚提交的集合**加上 `updated_by = 调用者自己`（同
 *     `pg-project-tags-repository.ts` 「echo of the caller's own request」那条论证），
 *     不披露任何别人的内容；写权限由 `authorizeManageMembers` 在用例里先判，它抛错、不产决策对象。
 */
import type { project } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type ProjectAiSourceKind = z.infer<typeof project.ProjectAiSourceKind>;

export interface ProjectAiSettingsRow {
  readonly projectId: string;
  readonly allowedSources: readonly ProjectAiSourceKind[];
  /** ISO 8601。 */
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface UpsertProjectAiSettingsCommand {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly allowedSources: readonly ProjectAiSourceKind[];
  readonly updatedBy: string;
}

export type UpsertProjectAiSettingsOutcome =
  | { readonly kind: "upserted"; readonly row: ProjectAiSettingsRow }
  /** 容器不存在（或不属于这个组织）——用例映射成 `NO_PROJECT_ROLE`，与「没有角色」不可分辨。 */
  | { readonly kind: "not-found" };

export interface ProjectAiSettingsRepository {
  /** 没有行 ⇒ `null` 载荷（仍然经 guard 出门，由用例决定默认值）。 */
  find(orgId: OrgId, projectId: string): Promise<Guarded<ProjectAiSettingsRow | null>>;
  upsert(cmd: UpsertProjectAiSettingsCommand): Promise<UpsertProjectAiSettingsOutcome>;
}

export const PROJECT_AI_SETTINGS_REPOSITORY = Symbol("ProjectAiSettingsRepository");
