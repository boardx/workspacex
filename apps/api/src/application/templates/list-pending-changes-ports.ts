/**
 * F29 补实现（#1667）：`templates.listPendingChanges` 的只读端口——本仓第一次真正
 * 能把「提交回蓝本」这个动作的落库结果读回来验证（此前只有 `submit` 的写路径，
 * 没有任何调用方能确认写进去的记录真的还在）。
 *
 * ⚠ 只读、独立于 `SubmitChangeRequestRepository`（那个端口只有 `create`，`pending-change-
 *   not-live.test.ts` 的类型层断言默认它的方法集合就是「提交」这一件事——加一个 `list`
 *   会让那份断言的措辞需要重新核对，不如另开一个端口干净）。
 */
import type { OrgId } from "../../domain/org-id";
import type { PendingChangeRecord } from "../../domain/templates/pending-change";

export interface ListPendingChangesRepository {
  list(orgId: OrgId, blueprintId: string): Promise<readonly PendingChangeRecord[]>;
}

export const LIST_PENDING_CHANGES_REPOSITORY = Symbol("ListPendingChangesRepository");
