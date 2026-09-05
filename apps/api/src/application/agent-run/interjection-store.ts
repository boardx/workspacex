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
import type { artifactsSteering as AS } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";

/**
 * Phase 14 后续 A（#2755）：已被网关检查点消费（账本已留痕、L2 授权已按需撤销）、
 * 但还没有真正回灌进内核的那条插话。形状就是投递给内核的线上形状（契约
 * `KernelInterjection`），不另起一份。
 */
export type StagedKernelInterjection = z.infer<typeof AS.KernelInterjection>;

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

  /**
   * Phase 14 后续 A（#2755）：第二个单槽——"网关已消费、内核未收到"。检查点消费一条
   * 插话后落进这里，等同一个 run 的**下一次** `ModelCallInput`（HITL 之后的 resume
   * 续跑）把它带给内核。同样单槽覆盖：内核收到之前又来一条并被消费，后者代表更新
   * 的意图（R7），覆盖前者。
   */
  stageForKernel(orgId: OrgId, runId: string, interjection: StagedKernelInterjection): Promise<void>;

  /**
   * 原子取出并清空待投递内核的那条插话；没有则 `null`。只应在构造下一次
   * `ModelCallInput` 时调用一次——"看"与"消费"合一，同一条插话因此只会出现在
   * 一次内核调用的输入里，不会在后续每次 resume 里重复投递。
   */
  takeStagedForKernel(orgId: OrgId, runId: string): Promise<StagedKernelInterjection | null>;
}

/**
 * 待投递内核的槽位上限。一个 run 在检查点之后一路跑到终态、中间没有任何 HITL
 * 停顿时，它的槽位不会被任何"下一次 ModelCallInput"取走（本 feature 如实记录的
 * 边界，见 `interjection-handling.ts` 头注）——纯内存实现按插入序淘汰最旧的，
 * 让这类残留有界，而不是随进程生命周期无限增长。
 */
const STAGED_FOR_KERNEL_MAX_ENTRIES = 1000;

/** 纯内存参考实现——测试用，也是生产环境当前唯一的实现（同文件头"非持久聚合根"）。 */
export function createInMemoryInterjectionStore(): InterjectionStore {
  const pending = new Map<string, PendingInterjection>(); // key: `${orgId}:${runId}`
  const staged = new Map<string, StagedKernelInterjection>(); // 同一种 key

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
    async stageForKernel(orgId, runId, interjection) {
      const key = `${orgId}:${runId}`;
      staged.delete(key); // 重新插入到末尾，淘汰序按"最近一次落槽"算。
      staged.set(key, interjection);
      while (staged.size > STAGED_FOR_KERNEL_MAX_ENTRIES) {
        const oldest = staged.keys().next().value;
        if (oldest === undefined) break;
        staged.delete(oldest);
      }
    },
    async takeStagedForKernel(orgId, runId) {
      const key = `${orgId}:${runId}`;
      const found = staged.get(key) ?? null;
      if (found !== null) staged.delete(key);
      return found;
    },
  };
}

export const INTERJECTION_STORE = Symbol("InterjectionStore");
