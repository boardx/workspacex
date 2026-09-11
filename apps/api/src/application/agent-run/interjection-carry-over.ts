/**
 * issue #3405（#3399 的治因项）—— **把未采纳的插话真的带进下一轮。**
 *
 * ## 它治的是什么
 *
 * composer 的占位文字逐字承诺「随时补充要求，agent 会在下一步前纳入」。run 在插话
 * 被应用之前就进终态时，这一轮**没有「下一步」**，承诺就断了：#3399 查明触发器给
 * 每条未应用插话记一条 `not_applied` 事件就结束，全仓没有任何一处把那句话带进下一轮。
 * 用户打的是一条指令（「总结成一个 pdf」），它被静默丢弃。#3400 的前端文案 +
 * 「重新发送」按钮是止血；本文件是治因。
 *
 * ## 为什么走 `acceptHumanMessage`，不新开一条 run 创建路径
 *
 * `agent_runs.input_message_id` 是 NOT NULL FK + `UNIQUE(org_id,input_message_id)`：
 * 一个 run 必须有一条真实的人类消息。本仓两次需要「服务端自己造一个 run」时
 * （`subtask_runs` / `skill_trial_runs`）都**刻意另开了表**，理由写在
 * `subtask-run-queue.ts` 头注里：硬造 chat 行会污染用户的线程。
 *
 * 带入插话恰恰相反 —— 它**就该**是用户线程里的一条消息：那句话本来就是用户说的，
 * 本来就该被回答。所以这里不造第二条 run 创建路径，而是复用 chat 受理的唯一入口
 * `acceptHumanMessage`（`DELIVERY` 端口由合成期接上）。白得四件事：
 *   ① 消息气泡天然出现在线程里，用户看得见「这一轮在执行我补的那句话」（约束②）；
 *   ② 新 run 走既有 cancel 全链路，`findRequesterUserId` 认的是真实作者（约束③）；
 *   ③ `clientMessageId` 幂等 ⇒ sweep 崩在「投递成功但没落状态」之间时，下一轮重放
 *      不会多起一轮；
 *   ④ L2 run 级授权按 run id 存，新 run 是新 id ⇒ **一条都继承不到**（约束⑤）。
 *      授权不被静默继承是结构决定的，不需要额外代码，也因此不会漂。
 *
 * ## 判定与投递分离，但判定只有一处
 *
 * 「这句话还要不要继续送」由 DB 触发器在终态转移那一刻判定
 * （migration `20260911060000`，取消 ⇒ 不带；已是带入轮 ⇒ 不带），结果落在行状态上。
 * 本文件只负责把已判定为 `carry_over_pending` 的行投出去，**不重复判定一次**
 * （AGENTS.md：同一事实不得声明在两处）。
 *
 * ## 多条插话合并成一条（约束④）
 *
 * 一轮里有多条未应用时按 `sequence`（收到时刻）正序换行拼成**一条**消息、起**一轮**。
 * 逐条起 N 轮会把一次丢失放大成 N 轮自动执行，那是另一种形式的失控。
 */
import { createHash } from "node:crypto";
import type { OrgId } from "../../domain/org-id";
import type { InterjectionStore } from "./interjection-store";

/** 一个来源 run 的全部待带入插话，已按收到时刻合并。 */
export interface CarryOverBatch {
  readonly originRunId: string;
  readonly threadId: string;
  readonly agentId: string;
  /** 真实作者 —— 新消息的 `author_id`，决定新 run 能不能被本人取消。 */
  readonly requesterUserId: string;
  readonly interjectionIds: readonly string[];
  /** 合并后的正文，逐字保留用户原话（不加前缀、不改写）。 */
  readonly text: string;
}

/**
 * 投递口。生产合成把它接到 `acceptHumanMessage`；应用层不直接依赖 chat 用例，
 * 免得 agent-run 与 chat 两个应用切面互相绑死。
 *
 * 返回新 run 的 id；返回 `null` = **拒绝投递**（线程已归档、可见性已撤销、agent 已下架
 * ……）。拒绝不是异常：那句话确实送不出去了，如实落回 `not_applied`，由用户手动
 * 「重新发送」，而不是原地重试到天荒地老。
 */
export interface InterjectionCarryOverDelivery {
  deliver(orgId: OrgId, batch: CarryOverBatch): Promise<string | null>;
}

export const INTERJECTION_CARRY_OVER_DELIVERY = Symbol("InterjectionCarryOverDelivery");

export interface SweepCarryOverDeps {
  readonly interjections?: InterjectionStore;
  readonly carryOver?: InterjectionCarryOverDelivery;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/**
 * 由来源 run id 推出的**确定性** `clientMessageId`（uuid 形状）。
 *
 * 一个来源 run 只会带入一次 —— 重放同一个 id 命中 `acceptHumanMessage` 的幂等分支，
 * 拿回同一个 run，不会多起一轮。随机 uuid 做不到这件事：sweep 崩在「投递成功但状态
 * 没落」之间时，下一轮会再起一轮真的 run。
 */
export function carryOverClientMessageId(originRunId: string): string {
  const h = createHash("sha256").update(`interjection-carry-over:${originRunId}`).digest("hex");
  // RFC 9562 §5.8 uuid v8（自定义来源的确定性 uuid）：版本位 8、variant 位 10。
  const v8 = `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${h.slice(18, 20)}-${h.slice(20, 32)}`;
  return v8;
}

/**
 * 一轮有界 sweep：把已判定待带入的插话投出去。由 `AgentRunExecutor.tick()` 调用，
 * 与既有的 claim/writeback 同一个触发条件（同租户的下一次动作），不新开轮询器。
 *
 * 任何一批失败都只 log 并继续下一批 —— 同 `executeQueuedRuns` 的既有纪律：一批里
 * 一条失败不拖垮其余。失败的那一批留在 `carry_over_pending`，下一次 tick 重试
 * （投递幂等，重试不会多起一轮）。
 */
export async function sweepInterjectionCarryOver(
  deps: SweepCarryOverDeps,
  input: { readonly orgId: OrgId; readonly limit?: number },
): Promise<number> {
  const store = deps.interjections;
  const delivery = deps.carryOver;
  if (!store?.listCarryOverPending || !store.settleCarryOver || !delivery) return 0;
  const batches = await store.listCarryOverPending(input.orgId, Math.min(20, input.limit ?? 10));
  let delivered = 0;
  for (const batch of batches) {
    try {
      const runId = await delivery.deliver(input.orgId, batch);
      await store.settleCarryOver(input.orgId, batch.originRunId, batch.interjectionIds, runId);
      if (runId !== null) delivered += 1;
      else {
        deps.log("interjection carry-over refused, left as not applied", {
          originRunId: batch.originRunId, threadId: batch.threadId,
        });
      }
    } catch (e) {
      // 留在 `carry_over_pending`，下一次 tick 重试。绝不在这里落 `not_applied`：
      // 那会把一次瞬时故障变成「这句话永久没人答」。
      deps.log("interjection carry-over delivery failed, will retry", {
        originRunId: batch.originRunId,
        detail: e instanceof Error ? `${e.name}: ${e.message}` : "unknown",
      });
    }
  }
  return delivered;
}
