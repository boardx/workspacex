/**
 * F25 的仓储端口 —— `updateGrouping` 边界（由 `application` 定义，`infrastructure` 实现）。
 *
 * 同 `save-and-sync-topic-ports.ts` 的先例：并发冲突由仓储的 `WHERE expectedRevision = …`
 * 更新语句产生（更新 0 行 ⇒ 抛 `GroupingRevisionConflictError`），应用层只负责把它翻译成
 * 契约码 `VERSION_CHANGED`，不在用例里先查一次 revision 再比较。
 */
import type { GroupPatch } from "../../domain/templates/grouping";

export interface UpdateGroupingCommand {
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
}
