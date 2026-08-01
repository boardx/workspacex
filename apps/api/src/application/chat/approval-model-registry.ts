/**
 * 批准卡与 model registry 之间的读口（F112 · I-31）。
 *
 * ⚠ **不是** `agent-runtime` 束（F48–F51）`ModelPoolRepository` 的第二份实现——它读的是
 * 同一张 `models` 表（迁移 `0019-f48-model-pool.sql`），只是取数窄得多：批准卡只需要
 * `kind`（本地/云端判据，D-U1）与 `unitPrice`（I-31 折算金额），不需要凭据、能力标签、
 * 组合成员等 `ModelPoolRepository.listForOrg` 返回的完整行。窄化一个已有仓储的读法，
 * 用一个专用端口表达比往 `ModelPoolRepository` 上加一个「只给我这三个字段」的方法更清楚——
 * 后者会让调用方以为契约层已经有一个「批准卡专用视图」，而事实上没有。
 *
 * `ModelKind` 类型从 `domain/model/registry.ts` 派生，不重新声明——避免又一份
 * 「本地/云端」枚举与 F48 的既有定义各写一份、迟早漂移。
 */
import type { OrgId } from "../../domain/org-id";
import type { ModelKind } from "../../domain/model/registry";
import type { ApprovalModelRow } from "../../domain/chat/approval-gate";

export interface ApprovalModelRegistryReader {
  /**
   * 只返回**在本组织 registry 里确实存在**的行；请求的 id 里若有任何一个查不到，
   * 该 id 就不出现在结果里——调用方（`create-approval-request.ts`）据「结果集是否覆盖
   * 全部请求 id」判定 `REGISTRY_UNAVAILABLE`，仓储本身不做这个判断（同 F109
   * `listProjectThreads` 的「候选给全，判定在别处」纪律）。
   */
  findModels(orgId: OrgId, modelIds: readonly string[]): Promise<readonly ApprovalModelRow[]>;
}

export const APPROVAL_MODEL_REGISTRY_READER = Symbol("ApprovalModelRegistryReader");

export type { ModelKind };
