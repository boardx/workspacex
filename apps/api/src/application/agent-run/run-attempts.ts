/**
 * F05 (`streaming-transport` 契约束 R4 E4) —— 放开「一条用户消息只能对应一个 run」
 * 约束。
 *
 * ## 不碰 `agent_runs` 的 `UNIQUE (org_id, input_message_id)`
 *
 * 那条约束是 #415 的「一条人类消息至多执行一次」保证，coord-main 已经在 #519 上
 * 裁定它优先于任何想往 `agent_runs` 里塞第二行的措辞（见
 * `20260805190000_i519_agent_run_retry.sql` 头注）。F05 走的是不同的口子：
 * `agent_runs` 一行仍然是唯一的「逻辑 run」，`messageId` 依旧只映射到那一个
 * `agent_runs.id`。「一个逻辑 run 多次续跑」体现为 `agent_run_attempts` 表里
 * 同一 `runId` 下递增的 `attemptSeq`——旧约束原样成立，旧约束保护的场景
 * （`accept()` 的幂等重放、`page()` 的 run 状态投影、#519 的重开边）一个都没被动。
 *
 * ## 可见性判定复用 chat 束，不另写一份
 *
 * `findMessageLocation` → `resolveVisibility` 是 `submit-message-rating.ts`
 * （F176）逐字相同的两步——刻意照抄：可见性是 chat 束的领域规则，这里再判一次就是
 * 第二套权限系统，而两套权限系统里总有一套没人在看（`thread-visibility.ts`
 * 文件头对同一件事的措辞）。「看不到」与「不存在」走同一个出口
 * （`MessageNotVisibleForAttemptsError`），同 usecases.md UC-2 的
 * `MESSAGE_NOT_VISIBLE` 一个错误码，不区分两种情况。
 *
 * 契约面：`packages/contracts/src/streaming-transport.ts` 的 `AgentRunAttempt` /
 * `operations.listRunAttemptsForMessage`（design-signoff 已确认，见
 * `phases/phase-14-agent-kernel-unification/contracts/streaming-transport/
 * design-signoff.md`）。
 */
import type { streamingTransport as ST } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";

export interface AgentRunAttemptStore {
  /**
   * Append 一条续跑记录。`attemptSeq` 由实现方在同一事务内计算（该 run 已有记录数
   * + 1），调用方不传——避免两个调用方各自算出不同的下一个序号（同
   * `commitWriteback`「读现存值算 seq，不接受调用方传入」的既有先例）。
   */
  recordAttempt(
    orgId: OrgId,
    input: {
      readonly runId: string;
      readonly resumedFromCheckpointId: string | null;
      readonly status: ST.AgentKernelRunStatus;
    },
  ): Promise<ST.AgentRunAttempt>;

  /** 一条用户消息触发的逻辑 run 的全部续跑记录，`attemptSeq` 升序。 */
  listForMessage(orgId: OrgId, messageId: string): Promise<readonly ST.AgentRunAttempt[]>;
}

export interface ListRunAttemptsForMessageDeps extends ResolveVisibilityDeps {
  readonly attempts: AgentRunAttemptStore;
}

/** usecases.md UC-2 的 `MESSAGE_NOT_VISIBLE`——「看不到」与「不存在」同一个出口。 */
export class MessageNotVisibleForAttemptsError extends Error {
  constructor() {
    super("message_not_visible");
    this.name = "MessageNotVisibleForAttemptsError";
  }
}

export async function listRunAttemptsForMessage(
  deps: ListRunAttemptsForMessageDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly messageId: string },
): Promise<{ readonly attempts: readonly ST.AgentRunAttempt[] }> {
  const location = await deps.chat.findMessageLocation(input.orgId, input.messageId);
  if (location === null) throw new MessageNotVisibleForAttemptsError();

  const outcome = await resolveVisibility(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: location.projectId,
    threadId: location.threadId,
  });
  if (outcome.kind !== "allow") throw new MessageNotVisibleForAttemptsError();

  return { attempts: await deps.attempts.listForMessage(input.orgId, input.messageId) };
}
