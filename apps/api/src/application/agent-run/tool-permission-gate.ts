import type { RestorableInterrupt } from "@repo/contracts/agent-interrupts";
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
 * 内核发来的中断（`completion.interrupted`）先过风险分级（`classifyToolCallRisk`，
 * issue #2767 起不再是裸的 `classifyToolRisk(toolName)`——`call_skill` 的等级按
 * `skillStableName` 在本次 run 挂载的 `skillRisks` 里查，其余工具名原样委托给
 * 既有的固定白名单）：
 * - 非 L2（理论上 L0/L1 不该触发中断——今天注册进内核的会中断的工具是 L2 的
 *   `call_skill`（挂了 L2 skill 时）与三个具名虚拟工具，见
 *   `packages/contracts/src/deep-agent-hitl.ts` 头注——但分级判断本身不假设"内核
 *   只会为 L2 工具中断"，防御性地把任何非 L2 中断也当作可以自动放行，不无谓地
 *   打断用户；issue #2767 之后这一支也是 L0/L1 skill 万一被内核错误 interrupt
 *   时的兜底，不产生任何 UI 事件）；
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
import { classifyToolCallRisk, type SkillRiskEntry } from "../../domain/agent-run/skill-risk-level";
import {
  DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS, NATIVE_L2_MANIFEST_TOOL_NAME, resolveDocumentGenerationGrantAddress,
} from "../../domain/agent-run/document-generation-skills";
import type { ExecuteAgentRunDeps } from "./execute-run";
import { record } from "./record-run-step";
import { publishStatusChange } from "./execute-run-events";
import { checkPendingInterjection } from "./interjection-handling";
import { PLAN_CONFIRMATION_TOOL_NAME } from "@repo/contracts/plan-control";

export interface InterruptedToolCall {
  readonly toolCallId?: string;
  readonly toolArgsDigest?: string;
  readonly toolName: string;
  readonly argsSummary: string | null;
    readonly interrupt?: RestorableInterrupt | null;
  /**
   * issue #2767 —— `call_skill` 中断时，目标 skill 的稳定名（`DeepAgentHitlToolArgs.
   * skill_stable_name`），由 provider 直接从待批工具调用的原始 args 里读出，不是从
   * `argsSummary` 反解析。非 `call_skill` 的中断（三个具名虚拟工具）不填。
   */
  readonly skillStableName?: string | null;
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
  /**
   * issue #2767 —— 本次 run 挂载集合里每个 skill 的风险等级，`execute-run.ts` 从
   * `toolSkills`（已经读出的 `PinnedSkillContent[]`）派生一次后原样传入。空数组
   * 是合法输入（非 deep-agent run、或没挂任何 skill）——此时任何 `call_skill`
   * 中断（理论上不该发生）都查不到等级，`classifyToolCallRisk` 按 fail-closed
   * 判 L2，不会因为传空数组而意外放行。
   */
  skillRisks: readonly SkillRiskEntry[] = [],
): Promise<{ readonly autoApproved: boolean }> {
  // Phase 14 F11：先消费待处理插话（若有），必要时撤销 run 级授权——见本文件头注。
  const seqCursor = { value: ledger.seq };
  await checkPendingInterjection(deps, orgId, runId, seqCursor);

  /*
   * issue #3132（B7）—— **计划确认中断不走风险分级这条路**。
   *
   * ⚠ 这里有一个会静默吞掉整道门的陷阱，写清楚以免被"简化"掉：`write_todos` 在
   * `tool-risk-tier.ts` 里是 **L0**（记账工具，不改变任何用户可见的外部状态——那个
   * 分级是对的，不该为了本 feature 去改它）。而下面的判定是「非 L2 ⇒ 已授权 ⇒
   * 自动放行并重新入队」。于是引擎明明停下来等用户确认计划了，网关会**立刻替用户
   * 点了确认**，run 一路跑完，前端连一帧 `planning` 都看不到——#3132 的同一种形态，
   * 只是搬到了这一层。
   *
   * 两个判定问的**不是同一个问题**，所以不能共用一条路径：
   * - 风险分级问「这次调用会不会造成不可逆/高风险副作用，需不需要授权」；
   * - 计划确认问「用户认不认这份计划」——它与副作用无关，`write_todos` 本来就没有
   *   副作用。
   *
   * 把 `write_todos` 挪进 L2 是错的修法：那会让**执行期**每一次标 `in_progress` /
   * `completed` 的调用都要人批准，同时把 phase 判成 `approving`（`call_skill` 的
   * 语义），确认门（只认 `planning`）又一次永不渲染。
   *
   * 正确的边界：引擎侧的 `_write_todos_requires_plan_confirmation` 谓词**已经**做完了
   * 全部判定（是不是首次实质性写入、步骤数够不够阈值）。中断能到达这里，就说明那个
   * 谓词说了「要停」。网关不该再问第二遍，更不该反悔——一律停进
   * `awaiting_tool_permission`。
   *
   * 「以后都允许」的常驻授权同样不适用：那是对**工具权限**的授权，不是对未来每一份
   * 计划的预先批准。所以这条分支直接跳过 `hasGrant`。
   */
  const isPlanConfirmation = interrupted.toolName === PLAN_CONFIRMATION_TOOL_NAME;

  const risk = classifyToolCallRisk(
    { toolName: interrupted.toolName, skillStableName: interrupted.skillStableName },
    skillRisks,
  );

  /*
   * issue #3440（重新设计，2026-09-11 人类裁决「推翻之前的设计，要以用户体验为优先级」）——
   * 四个锁定文档 skill 的 (skill_name, tool_name) 授权寻址。
   *
   * `grantAddress` 非空 ⇒ 这次中断可归因到四个锁定 skill 之一（`call_skill` 按
   * `interrupted.skillStableName` 直接判；原生 `execute` 改按**这个 run 迄今为止真实
   * 发生过的工具调用序列**归因——调用口径，不是第一版的挂载口径，见
   * `document-generation-skills.ts` 头注"重新设计"一节）。归因成立时，`authorized`
   * 多两条路径：
   *   1. composer 开关（`DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS` 这条组织级
   *      standing grant）打开 —— 全程零确认；
   *   2. 用户此前已经对**同一个 skill**批过"本次 run 内都允许"/"以后都允许"
   *      （`hasGrant(..., grantAddress)`，地址已经按 skill 收紧，不会跨 skill 泄漏）。
   * 归因不成立（`grantAddress === null`）⇒ 一律退回裸 `interrupted.toolName` 寻址，
   * 与本 feature之前逐字相同——这正是"清单之外仍要问"的安全边界，没有第二条判断。
   *
   * `priorToolCallSteps` 只在 `toolName` 是原生 `execute` 时才去查（legacy `call_skill`
   * 的归因不需要历史，直接读 `interrupted.skillStableName`）——避免每一次非 `execute`
   * 中断都白付一次数据库往返。`readToolCallAttributionSteps` 未注入（可选端口）时
   * 传空数组，`resolveNativeExecuteAttribution` 因此找不到任何已发生的锁定 skill 调用
   * 而返回 `null`——退回"每次都问"，fail closed，不是静默放行。
   */
  const priorToolCallSteps = interrupted.toolName === NATIVE_L2_MANIFEST_TOOL_NAME
    ? (await deps.runs.readToolCallAttributionSteps?.(orgId, runId)) ?? []
    : [];
  const grantAddress = resolveDocumentGenerationGrantAddress(
    interrupted.toolName, interrupted.skillStableName, skillRisks, priorToolCallSteps, interrupted.argsSummary,
  );
  const documentGenerationAutoApproved = grantAddress !== null
    && (await deps.toolPermissionGrants?.hasGrant(orgId, runId, DOCUMENT_GENERATION_AUTO_APPROVE_GRANT_ADDRESS) ?? false);
  const authorized = !isPlanConfirmation && (risk !== "L2"
    || documentGenerationAutoApproved
    || (await deps.toolPermissionGrants?.hasGrant(orgId, runId, grantAddress ?? interrupted.toolName) ?? false));

  if (authorized) {
    // R4 A2：已授权同类操作不再触发确认，直接执行——但完整信息仍然进账本（I-3），
    // 不是静默跳过留痕。
    await record(deps, orgId, {
      runId, seq: seqCursor.value, kind: "model_called", startedAt: ledger.modelStartedAt,
      inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
      planningNote: `已授权同类操作，自动放行：${interrupted.toolName}`,
      inputFullContent: ledger.system,
    });
    /*
     * issue #3420 —— 这里此前调的是 `approveAndRequeue`，而那条 UPDATE 的 WHERE 是
     * `status='awaiting_tool_permission'`。此刻 run 正处于 `running`（它就是在执行中
     * 被中断的）⇒ 命中 0 行、返回值被丢弃 ⇒ 「自动放行」只是嘴上说说：run 停在
     * `running` 一动不动，没人会再去领它，直到租约到期被恢复流程捞起，把用户**已经
     * 授权过**的那个工具再问一遍（人类实测：run 1ebd3c81，09:35:23 落库的 run 级
     * 授权，09:37:44 又停在 awaiting_tool_permission）。
     * `requeueAuthorizedToolCall` 是 running → queued 那条边，见 `ports.ts`。
     */
    const requeued = await deps.runs.requeueAuthorizedToolCall?.(orgId, runId, interrupted)
      ?? await deps.runs.approveAndRequeue(orgId, runId);
    if (!requeued) {
      // 输了竞态（取消/失败/被别处收走）——不重试、不覆盖，如实记一行日志即可：
      // 这条 run 已经不归这次执行管了。
      deps.log?.("authorized tool call requeue lost the race", { runId, toolName: interrupted.toolName });
    }
    return { autoApproved: true };
  }

  // I-1：L2 且未授权，没有例外——停进 awaiting_tool_permission 等人四选一裁决。
  await record(deps, orgId, {
    runId, seq: seqCursor.value, kind: "model_called", startedAt: ledger.modelStartedAt,
    inputDigest: ledger.systemDigest, outputDigest: null, failureCode: null,
    planningNote: isPlanConfirmation
      ? "等待用户确认计划后再执行"
      : `等待人工批准：${interrupted.toolName}`,
    // Phase 14 F15 -- 模型看到了什么（`system`）。此刻尚未产出完整回复，`outputFullContent`
    // 留空，与 `outputDigest: null` 同一个事实（无输出可摘）。
    inputFullContent: ledger.system,
  });
  // issue #3440：`grantScope` 是纯内部寻址字段，不影响 `interrupted` 本身投影给 UI 的
  // `toolName`/展示——只有用户随后选"本次 run 内都允许"/"以后都允许"时才会被用到。
  await deps.runs.markAwaitingToolPermission(orgId, runId, { ...interrupted, grantScope: grantAddress });
  publishStatusChange(deps, orgId, runId, "awaiting_tool_permission");
  return { autoApproved: false };
}
