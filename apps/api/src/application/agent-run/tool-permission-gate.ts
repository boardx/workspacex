/**
 * Phase 14 F06（`plan-permissions` 契约束 R3 步骤 4-6，R5，I-1/I-4）—— 内核中断在一个
 * 工具调用前时，网关这一层该做什么的**唯一落点**。
 *
 * ## 为什么抽出成独立文件
 *
 * `execute-run.ts` 自带机械看守的行数上限（`tests/agent-run/execute-run-thin-gateway.
 * test.ts`，F01 的"薄网关"回归门），同 `execute-run-events.ts`/`record-run-step.ts`
 * 抽出的理由——这里的分级+授权判断是真实、附加的业务逻辑（不是第四条执行分支），
 * 但不是"转发一次调用给内核"这条核心链路本身，放进自己的文件让 `execute-run.ts`
 * 的调用点保持一行，不必为了这个 feature 再啃掉那份行数预算。
 *
 * ## 判定逻辑（R5 权限分级表 + R4 A2 已授权跳过确认）
 *
 * 内核发来的中断（`completion.interrupted`）先过风险分级（`classifyToolRisk`）：
 * - 非 L2（理论上 L0/L1 不该触发中断——今天注册进内核的唯一会中断的工具就是 L2 的
 *   `call_skill`，见 `packages/contracts/src/deep-agent-hitl.ts` 头注——但分级判断
 *   本身不假设"内核只会为 L2 工具中断"，防御性地把任何非 L2 中断也当作可以自动放行，
 *   不无谓地打断用户）；
 * - L2 且命中既有授权（`grants.hasGrant`：本 run 内曾"以后都允许"或"本次 run 内都
 *   允许"）：不再触发 `awaiting_tool_permission`，直接自动放行（R4 A2），但仍然落一条
 *   完整留痕的账本记录（I-3：完整信息，不是摘要），供用户事后查看；
 * - L2 且未命中授权：I-1 唯一允许的分支——没有例外，进入 `awaiting_tool_permission`
 *   等人四选一裁决（`decide-tool-permission.ts`）。
 *
 * `grants` 端口是**可选**依赖：缺省（未注入）时 `hasGrant` 恒为 false，行为与本
 * feature 之前逐字节相同——每次 L2 中断都进 `awaiting_tool_permission`，同既有测试
 * （`gateway-forwarding.test.ts` 等）的默认预期一致，这也是它们不需要跟着改的原因。
 *
 * ## Phase 14 F11（R4 E3）—— 计算 `authorized` 之前先看一眼是否有待处理插话
 *
 * 内核发来中断，说明被挡下的这次调用**尚未执行**（中断在执行前拦截），所以这里插话
 * 检查点不会打断任何"正在进行中"的调用（I-5）。若插话判定为方向性改变，
 * `checkPendingInterjection` 会先撤销本 run 的 run 级授权——这必须发生在下面
 * `hasGrant` 查询之前，`authorized` 才能正确反映"旧授权已经因为任务性质变了而失效"。
 */
import type { OrgId } from "../../domain/org-id";
import { classifyToolRisk } from "../../domain/agent-run/tool-risk-tier";
import type { ExecuteAgentRunDeps } from "./execute-run";
import { record } from "./record-run-step";
import { publishStatusChange } from "./execute-run-events";
import { checkPendingInterjection } from "./interjection-handling";

export interface InterruptedToolCall {
  readonly toolName: string;
  readonly argsSummary: string | null;
}

/**
 * 处理一次内核中断。落账本记录并推动 run 状态——要么自动放行继续跑（`autoApproved:
 * true`，调用方不需要再做任何事，run 已经重新入队），要么停进
 * `awaiting_tool_permission` 等人裁决（`autoApproved: false`）。
 */
export async function handleInterruptedToolCall(
  deps: ExecuteAgentRunDeps,
  orgId: OrgId,
  runId: string,
  interrupted: InterruptedToolCall,
  ledger: { readonly seq: number; readonly modelStartedAt: string; readonly systemDigest: string; readonly system: string },
): Promise<{ readonly autoApproved: boolean }> {
  // Phase 14 F11：先消费待处理插话（若有），必要时撤销 run 级授权——见本文件头注。
  const seqCursor = { value: ledger.seq };
  await checkPendingInterjection(deps, orgId, runId, seqCursor);

  const risk = classifyToolRisk(interrupted.toolName);
  const authorized = risk !== "L2"
    || (await deps.toolPermissionGrants?.hasGrant(orgId, runId, interrupted.toolName) ?? false);

  if (authorized) {
    // R4 A2：已授权同类操作不再触发确认，直接执行——但完整信息仍然进账本（I-3），
    // 不是静默跳过留痕。
    await record(deps, orgId, {
      runId, seq: seqCursor.value, kind: "model_called", startedAt: ledger.modelStartedAt,
      inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
      planningNote: `已授权同类操作，自动放行：${interrupted.toolName}`,
      inputFullContent: ledger.system,
    });
    await deps.runs.approveAndRequeue(orgId, runId);
    return { autoApproved: true };
  }

  // I-1：L2 且未授权，没有例外——停进 awaiting_tool_permission 等人四选一裁决。
  await record(deps, orgId, {
    runId, seq: seqCursor.value, kind: "model_called", startedAt: ledger.modelStartedAt,
    inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
    planningNote: `等待人工批准：${interrupted.toolName}`,
    // Phase 14 F15 -- 模型看到了什么（`system`）。此刻尚未产出完整回复，`outputFullContent`
    // 留空，与 `outputDigest: null` 同一个事实（无输出可摘）。
    inputFullContent: ledger.system,
  });
  await deps.runs.markAwaitingToolPermission(orgId, runId, interrupted);
  publishStatusChange(deps, orgId, runId, "awaiting_tool_permission");
  return { autoApproved: false };
}
