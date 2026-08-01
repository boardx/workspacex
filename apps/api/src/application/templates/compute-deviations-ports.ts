/**
 * F29 的仓储端口 —— `computeDeviations` 的两次读取（由 `application` 定义，
 * `infrastructure` 实现）。
 *
 * ⚠ 两个方法而不是一个：diff 基准（绑定的蓝本版本快照）与项目当前值分属两张表，
 * 「先查绑定再查当前值」不是同一事务需要的两件事——两者都是只读，不存在
 * `applyBlueprint` 那种「要么全成功要么整体回滚」的写事务边界，拆成两个方法
 * 让调用方（或未来的缓存层）可以各自独立地失败与重试。
 */
import type { OrgId } from "../../domain/org-id";

/** 项目绑定的蓝本版本快照——diff 的基准（`uc-2-2` 快照绑定，本用例只读引用）。 */
export interface ProjectBlueprintBinding {
  readonly blueprintId: string;
  readonly baseVersionId: string;
  /** 冻结快照内容，同 `BlueprintVersion.content`——本用例不改写它 */
  readonly baseContent: Readonly<Record<string, unknown>>;
}

export interface ComputeDeviationsRepository {
  /** null = 该项目未绑定任何蓝本（不该发生在已建项目上，仓储层仍需能表达它）。 */
  findProjectBinding(orgId: OrgId, projectId: string): Promise<ProjectBlueprintBinding | null>;
  /** 项目当前的设计配置值，按 `designFacetKey` 存放。 */
  findCurrentProjectContent(orgId: OrgId, projectId: string): Promise<Readonly<Record<string, unknown>>>;
}
