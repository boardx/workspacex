/**
 * F25 的仓储端口 —— `updateGrouping` 边界（由 `application` 定义，`infrastructure` 实现）。
 *
 * 同 `save-and-sync-topic-ports.ts` 的先例：并发冲突由仓储的 `WHERE expectedRevision = …`
 * 更新语句产生（更新 0 行 ⇒ 抛 `GroupingRevisionConflictError`），应用层只负责把它翻译成
 * 契约码 `VERSION_CHANGED`，不在用例里先查一次 revision 再比较。
 */
import type { GroupPatch } from "../../domain/templates/grouping";
import type { OrgId } from "../../domain/org-id";

export interface UpdateGroupingCommand {
  /** 2026-08-16（F950，delta）：同 `save-and-sync-topic-ports.ts` 那条注释，接真 Postgres
   *  需要租户范围，此前的内存假仓储不需要它。 */
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly groupCount: number | null;
  readonly groups: readonly GroupPatch[];
  readonly expectedRevision: string;
}

export interface UpdatedGrouping {
  readonly groups: readonly GroupPatch[];
  readonly revision: string;
}

/** `expectedRevision` 与仓储持有的当前 revision 不一致——分组被并发改过。 */
export class GroupingRevisionConflictError extends Error {
  constructor() {
    super("grouping revision changed concurrently");
    this.name = "GroupingRevisionConflictError";
  }
}

export interface GroupingRepository {
  updateGrouping(cmd: UpdateGroupingCommand): Promise<UpdatedGrouping>;

  /**
   * 2026-08-16（F950，delta）：读当前分组。空数组 = 真实空态（还没分组，同
   * `getProjectPrep`「不套蓝本的空项目四子标签真实空态」那条纪律），不是失败。
   * `revision` 恒有值——项目一建好 `project_grouping_revision` 就有一行（见仓储实现）。
   */
  getGrouping(orgId: OrgId, projectId: string): Promise<UpdatedGrouping>;
}

export const GROUPING_REPOSITORY = Symbol("GroupingRepository");
