/**
 * Phase 14 F11（`artifacts-steering` 契约束 R3'，domain.md `Interjection`）—— 中途插话的
 * 暂存端口。domain.md 把 `Interjection` 明确定为"非持久聚合根，事件驱动"：它只需要在
 * "用户发了插话" 与 "内核在下一次工具调用之间看到它" 之间存活很短的一段时间，不需要
 * 跨进程重启存活，也不需要历史查询——因此不是一张表，是一个单槽暂存位。
 *
 * 单槽而不是队列：同一个 run 在被内核消费之前又收到第二条插话，代表用户的意图已经
 * 更新（R7"插话是对当前任务的调整"），后一条覆盖前一条，而不是排队等着依次注入——
 * 排队会让内核在同一次检查点里看到两条互相矛盾的"最高优先级指令"。
 */
import type { OrgId } from "../../domain/org-id";

export interface PendingInterjection {
  readonly interjectionId: string;
  readonly text: string;
  readonly receivedAt: string;
}

export interface InterjectionStore {
  /** 记录一条新插话，覆盖该 run 此前任何尚未被消费的一条（见文件头"单槽覆盖"）。 */
  submit(orgId: OrgId, runId: string, interjection: PendingInterjection): Promise<void>;

  /**
   * 原子取出并清空该 run 当前暂存的插话；没有则 `null`。"内核在下一次工具调用之间
   * 检查是否有新插话"的检查点只应调用这一个方法——它同时是"看"和"消费"，不会让
   * 同一条插话在两次检查点各触发一次判断（R4 步骤 3）。
   */
  takePending(orgId: OrgId, runId: string): Promise<PendingInterjection | null>;
}

/** 纯内存参考实现——测试用，也是生产环境当前唯一的实现（同文件头"非持久聚合根"）。 */
export function createInMemoryInterjectionStore(): InterjectionStore {
  const pending = new Map<string, PendingInterjection>(); // key: `${orgId}:${runId}`

  return {
    async submit(orgId, runId, interjection) {
      pending.set(`${orgId}:${runId}`, interjection);
    },
    async takePending(orgId, runId) {
      const key = `${orgId}:${runId}`;
      const found = pending.get(key) ?? null;
      if (found !== null) pending.delete(key);
      return found;
    },
  };
}

export const INTERJECTION_STORE = Symbol("InterjectionStore");
