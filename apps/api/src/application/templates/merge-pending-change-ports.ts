/**
 * F29 的仓储端口 —— `mergePendingChange` 的写事务边界。
 *
 * ⚠ `mergeIntoDraft` 只接受"把哪个 key 改成什么值"，同样不给"顺手改别的字段"
 * 留语法空间——合并的效果被裁到只剩一件事：这一条待审改动的 `afterValue`
 * 进蓝本**草稿**，且这条记录自己转 `merged`（同一事务）。发布仍要走
 * `publishBlueprintVersion` 的门槛，本端口不触碰版本表。
 */
export interface MergeIntoDraftCommand {
  readonly blueprintId: string;
  readonly changeRequestId: string;
  readonly designFacetKey: string;
  readonly afterValue: string;
}

export interface MergePendingChangeRepository {
  /** 事务：草稿字段更新 + 该待审改动记录转 `merged`。 */
  mergeIntoDraft(cmd: MergeIntoDraftCommand): Promise<void>;
}
