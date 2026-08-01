/**
 * F29 的仓储端口 —— `submitBlueprintChangeRequest` 的写事务边界。
 *
 * ⚠ 与 `ApplyBlueprintRepository` 同一条纪律：这里**只**新增待审改动记录，
 * 端口的方法签名里没有任何能触及蓝本表或蓝本版本表的入参——「提交 ≠ 生效」
 * 不是一句应用层的自觉，是仓储端口的形状本身就表达不出"顺手改一下蓝本"这件事
 * （I-10）。`pending-change-not-live.test.ts` 断言的正是：喂给这个端口的假仓储
 * 从未被要求接触任何蓝本快照。
 */
import type { PendingChangeRecord } from "../../domain/templates/pending-change";

export interface SubmitChangeRequestRepository {
  /** 批量写入待审改动记录，返回落库后的记录（真实 id 可能由存储层生成）。 */
  create(records: readonly PendingChangeRecord[]): Promise<readonly PendingChangeRecord[]>;
}
