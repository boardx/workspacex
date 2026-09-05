/**
 * Phase 14 F11（`artifacts-steering` 契约束 R3'，domain.md I-5/I-6，E3）—— run 处于
 * `running` 时收到的插话，在"下一次工具调用之间"这个检查点该怎么处理的唯一落点。
 *
 * ## 为什么抽出成独立文件
 *
 * 同 `tool-permission-gate.ts`/`execute-run-events.ts`/`record-run-step.ts` 的既有理由：
 * `execute-run.ts` 自带机械看守的行数上限（`execute-run-thin-gateway.test.ts`），这里的
 * 插话消费+分类+联动判断是真实、附加的业务逻辑，放进自己的文件不必啃掉那份行数预算。
 *
 * ## 检查点在哪、为什么这里满足 I-5（插话不打断当前调用）
 *
 * 调用方只在两个天然的"工具调用之间"位置调用本文件的 `checkPendingInterjection`：
 * `execute-run.ts` 的 `onProgress` 回调里、且只在一次工具调用的**终态**事件
 * （`phase !== "in_progress"`）之后；`tool-permission-gate.ts` 的
 * `handleInterruptedToolCall` 里、且在计算是否放行**之前**（此时被中断的那次调用尚未
 * 真正执行，只是被内核挡在执行前）。两个检查点都不落在"一次调用正在执行中"的区间内，
 * 插话因此从不会打断一次已经开始的工具调用，只影响它结束之后的下一步。
 *
 * ## "最高优先级上下文"体现在哪：账本一行 + 回灌内核（#2755）
 *
 * 本函数消费到一条待处理插话时，落一条 `model_called` 账本记录（复用
 * `handleInterruptedToolCall` 自己已经在用的"非真实模型调用、只带 planningNote 的
 * 账本行"写法），`planningNote` 原文带上插话文本——这是"网关侧确实看到了它、并把它
 * 记进了这个 run 唯一的事实来源"的证据。
 *
 * Phase 14 后续 A（#2755）补上 F11 如实记录的那道边界：消费后的插话同时落进
 * `InterjectionStore.stageForKernel`，等同一个 run 的**下一次** `ModelCallInput`
 * 把它带给内核（`takeInterjectionForKernel`，`execute-run.ts` 构造输入时调用一次）；
 * deep-agent provider 把它投影到 LangGraph `configurable.interjection`，`harness.py`
 * 的 `InterjectionMiddleware` 以最高优先级 human 消息注入图、并把下一次模型调用钉成
 * `write_todos` 重规划——R12"下一步执行路径体现新指令"从此在内核层成立，不只在账本层。
 *
 * ⚠ "下一次 ModelCallInput"是哪一次，如实写清楚：`executeClaimed` 对一个 run 一次只发
 * 一次内核调用，同一个 run 再有一次 `ModelCallInput` 只会是 HITL 中断之后的 resume
 * 续跑（自动放行 `approveAndRequeue`，或人四选一后重新入队）。两个检查点里，
 * `handleInterruptedToolCall` 那个天然紧接着一次 resume；`onProgress` 终态事件那个
 * 只有当同一次内核调用随后停在 interrupt 时才会有下一次输入。一个 run 若在检查点
 * 之后一路跑到终态、中间没有任何停顿，这条插话到不了内核——要做到"任意时刻打进正在
 * 跑的图"需要 LangGraph multitask `interrupt`（会丢掉进行中那一步，违反 I-5）或
 * Python 侧回调轮询（另一块独立改动），都不在本 feature 范围。
 *
 * ## E3：方向性改变 ⇒ 本 run 内的 L2 授权范围整体失效
 *
 * "方向性改变"（`classifyInterjection` 判定为 `direction_change`）意味着任务性质可能已
 * 变，此前"本次 run 内都允许"的授权是在旧任务性质下给出的，继续沿用会让用户在不知情
 * 的情况下对一个不同性质的高风险操作说了"是"。因此整体撤销该 run 的 run 级授权
 * （`revokeAllForRun`），迫使下一次同类 L2 调用重新走一次四选一裁决，而不是沿用旧授权。
 * 组织级"以后都允许"是与本 run 上下文无关的独立人类决定，不受影响（R5）。
 *
 * ## 判定"是否方向性改变"不是本函数的算法权威
 *
 * `04-artifacts-steering.md` A2/E3 都明写"具体识别策略属于内核实现细节，不规定算法"——
 * `classifyInterjection` 只是一个可替换的、确定性的关键词启发式，不是这个判断唯一
 * 可能的实现；真正的语义理解留给未来接入的内核侧分类器，替换它不改变本文件其余部分
 * 的契约（同一个理由，`tool-risk-tier.ts` 的固定白名单也不是唯一可能的分级实现）。
 *
 * ## 触发 `plan_update` 的边界（刻意不在这里发一个编造的事件）
 *
 * `usecases.md`"跨束委托"一节明写：插话触发的重新规划、是否需要重新走计划确认，
 * 由内核判断，不在本束（也因此不在本函数）约束——真正的 `plan_update` 事件在内核据此
 * 重新调用 `write_todos` 时，经由既有的 `forwardToolCallProgress` 路径自然产生（同一份
 * 解析纪律、同一条"宁可没有也不编造"的反空转规则）。本函数不重复发明第二条
 * `plan_update` 产生路径。
 */
import type { artifactsSteering as AS } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { ExecuteAgentRunDeps } from "./execute-run";
import type { ModelCallInput } from "./ports";
import { record } from "./record-run-step";

/**
 * 简单、确定性、可替换的启发式：命中这些"换方向"信号词判定为方向性改变，否则视为
 * 对当前任务的局部调整（R7：插话默认是调整，不是取消/另起任务）。
 */
const DIRECTION_CHANGE_SIGNAL_WORDS = [
  "算了", "不用了", "不对", "不是这个", "换成", "换个方向", "其实我想要", "重新来",
  "改变方向", "先别管刚才", "忘了刚才", "另外做",
] as const;

/** 取值的唯一事实源在契约（Python 侧 `harness.py` 读同一组值，parity 测试机械比对）。 */
export type InterjectionClassification = z.infer<typeof AS.InterjectionClassification>;

export function classifyInterjection(text: string): InterjectionClassification {
  const trimmed = text.trim();
  return DIRECTION_CHANGE_SIGNAL_WORDS.some((w) => trimmed.includes(w))
    ? "direction_change"
    : "adjustment";
}

/** 一条已消费的插话——形状就是投递内核的线上形状（契约 `KernelInterjection`），不另起一份。 */
export type AppliedInterjection = z.infer<typeof AS.KernelInterjection>;

/**
 * 一次"下一次工具调用之间"检查点。没有待处理插话 ⇒ `null`，调用方不做任何事——绝大多数
 * 检查点都会落在这一支，本函数因此必须是零 IO 的快速路径（只有真的 `takePending` 命中
 * 才会再有后续的 `revokeAllForRun`/`record` 调用）。
 */
export async function checkPendingInterjection(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  runId: string,
  seqCursor: { value: number },
): Promise<AppliedInterjection | null> {
  if (!deps.interjections) return null;
  const pending = await deps.interjections.takePending(orgId, runId);
  if (pending === null) return null;

  const classification = classifyInterjection(pending.text);
  if (classification === "direction_change") {
    await deps.toolPermissionGrants?.revokeAllForRun(orgId, runId);
  }

  const startedAt = deps.clock.now();
  await record(deps, orgId, {
    runId, seq: seqCursor.value, kind: "model_called", startedAt,
    inputDigest: null, outputDigest: null, failureCode: null,
    planningNote: classification === "direction_change"
      ? `已插话，注入为最高优先级上下文：${pending.text}`
        + "（内核判定为方向性改变，是否重新触发计划确认由内核决定）"
      : `已插话，注入为最高优先级上下文：${pending.text}（内核判定为局部调整，按原计划继续执行）`,
  });
  seqCursor.value += 1;

  const applied: AppliedInterjection = {
    interjectionId: pending.interjectionId, text: pending.text, classification, receivedAt: pending.receivedAt,
  };
  // #2755：等下一次 ModelCallInput 带给内核（见文件头注"回灌内核"一节）。
  await deps.interjections.stageForKernel(orgId, runId, applied);
  return applied;
}

/**
 * Phase 14 后续 A（#2755）：构造下一次 `ModelCallInput` 时调用**一次**——原子取出该 run
 * 待投递内核的插话，作为可展开的输入片段返回。没有 ⇒ 空对象，展开后 `interjection`
 * 这个键**根本不出现**（不是 `undefined` 值），请求逐字节与本 feature 之前相同。
 */
export async function takeInterjectionForKernel(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  runId: string,
): Promise<Pick<ModelCallInput, "interjection"> | Record<never, never>> {
  if (!deps.interjections) return {};
  const staged = await deps.interjections.takeStagedForKernel(orgId, runId);
  return staged === null ? {} : { interjection: staged };
}
