"use client";
import * as React from "react";
import { CALL_SKILL_TOOL_NAME } from "@/lib/agent-run-phase";
import { RestoredInterruptForm } from "./restored-interrupt-form";
import { agentInterrupts, planPermissions, wave2Runtime } from "@repo/contracts";
import { getAgentRun, type AgentRunView } from "@/lib/agent-run";
import { apiRequest } from "@/lib/api-client";
import { InterruptDecisionDialog } from "./interrupt-decision-dialog";
import { useDialogReturnFocus } from "./use-dialog-return-focus";
import {
  ToolPermissionCard,
  type ToolPermissionCardDecision,
  type ToolPermissionCardRequest,
} from "@/components/agent-kernel/tool-permission-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * issue #3212 —— 待批 `call_skill` 到底要调哪个技能，服务端已经在 `argsSummary` 里如实
 * 给了（`{skill_stable_name, task}` 的 JSON，`deep-agent-model-provider.ts` 写下）。
 * 此前卡片把它丢掉，intent 恒为「调用一个需要授权的技能」——于是**每一次**授权弹窗
 * 逐像素相同：用户既分不清这次问的是哪个技能，也分不清"又弹了一次"是新请求还是
 * 上次点击没生效（#3186 的「点了没反应」正是这样与真实机理混同的）。
 *
 * 只读展示，不参与任何授权判定：解析失败一律回落到原文案，绝不因为读不出名字而放行。
 */
function calledSkillStableName(argsSummary: string | null): string | null {
  if (!argsSummary) return null;
  try {
    const parsed: unknown = JSON.parse(argsSummary);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const name = (parsed as Record<string, unknown>).skill_stable_name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch { return null; }
}

function permissionCardRequest(toolName: string, argsSummary: string | null): ToolPermissionCardRequest {
  const skill = toolName === CALL_SKILL_TOOL_NAME ? calledSkillStableName(argsSummary) : null;
  return {
    risk: "L2",
    intent: toolName === CALL_SKILL_TOOL_NAME
      ? (skill ? `调用技能「${skill}」（需要授权）` : "调用一个需要授权的技能")
      : `调用工具 ${toolName}`,
    rationale: "该操作被运行时判定为高风险，可能产生不可逆或外部可见的影响。",
    command: argsSummary ?? "服务端尚未提供参数摘要。",
    affects: "服务端尚未提供更具体的影响对象；如范围不明确，请拒绝此次执行。",
  };
}
/** Authoritative pending request identity survives refresh; summaries are display-only. */
export function RestoredRunApproval(props: { runId: string; bearer?: string; canWrite?: boolean; fallbackInterrupt?: agentInterrupts.RestorableInterrupt }): JSX.Element | null {
  return <ApprovalSession key={props.runId} {...props} />;
}
function ApprovalSession({ runId, bearer, canWrite = true, fallbackInterrupt }: { runId: string; bearer?: string; canWrite?: boolean; fallbackInterrupt?: agentInterrupts.RestorableInterrupt }): JSX.Element | null {
  const [run, setRun] = React.useState<AgentRunView | null>(null);
  const [consumedRequestId, setConsumedRequestId] = React.useState<string | null>(null);
  /**
   * issue #3244 ① —— 「提交以后在 chat 上又看到了这个界面」。
   *
   * 事件流里那条中断的 tool call 在裁决之后并不会翻成 `complete`（裁决走的是 REST
   * `decision`，不是 CopilotKit 的 tool result），于是 `copilotkit-v2-agent-interrupts.tsx`
   * 那条 `status !== "complete"` 会一直把**同一个已被消费的中断**当 `fallbackInterrupt`
   * 交下来。下面第 113 行原本无条件把它演成「等待服务端确认此请求，确认后即可继续。」——
   * 而此刻权威读的 `pendingApproval` 是 `null`：**服务端根本没有在等任何确认**。
   * 界面因此对用户说了一句假话，用户只能理解成「我刚才那次没生效」。
   *
   * 修的不是「别再渲染」（那会连同真正的未持久化窗口一起吞掉，属于用「前端不渲染」
   * 掩盖问题）。修的是**分清两种 `pendingApproval === null`**：
   *   - 从来没被持久化过（中断事件早于 run 记录落库）⇒ 「等待服务端确认」是真话，照旧；
   *   - 曾经被权威读确认存在、现在消失了 ⇒ 它**已被裁决**，应当以「已结束的确认记录」
   *     的形态留痕（与第 110 行同一形态），而不是再问一次。
   *
   * 判据是权威读自己给过的事实，不是界面痕迹：只有当某次 `getAgentRun` 的
   * `pendingApproval.interrupt` 与这个 `fallbackInterrupt` **逐字同一**（toolName +
   * requestId）时才置位。置位之后不再回落——同一个 requestId 不会二次进入待决。
   */
  const [fallbackWasPending, setFallbackWasPending] = React.useState(false);
  const inFlight = React.useRef(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [permissionOpen, setPermissionOpen] = React.useState(true);
  // 同 InterruptDecisionDialog：这个弹窗也是挂载即打开、没有用户 trigger（TW-A11Y-5）。
  const returnPermissionFocus = useDialogReturnFocus(permissionOpen);
  React.useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const value = await getAgentRun(runId, bearer, controller.signal); if (!controller.signal.aborted) setRun(value); if (["succeeded", "failed", "cancelled"].includes(value.status)) return; }
      catch (cause) { if (!controller.signal.aborted) setError(String(cause)); }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, bearer]);
  const request = run?.pendingApproval;
  /**
   * issue #3212 ② / #3302 —— 「这是本次任务里第几次请求授权、上次选了哪档」。
   *
   * 实测（`tool-permission-gate.ts` + `permission-grant-scopes.test.ts`）：`run`/`forever`
   * 两档的写入键与查询键逐字一致，授权**没有丢**；会再问一次的只有「仅本次允许」——那一档
   * 按 I-4 本来就不落授权记录，下一次同类调用再问是**正确**的。所以这里修的不是授权判定
   * （一个字都不动，放宽即安全倒退），而是「用户看不出为什么又问」。
   *
   * ⚠ #3302：这个计数**不是**本组件数出来的。它曾经是一个 `useState`，而本组件的挂载门
   * （`copilotkit-v2-panel-body.tsx`）是 `status === "awaiting_tool_permission"`：同一条 run
   * 的两次中断之间整段是 `running`，组件被**正确地**卸载，计数当场销毁 ⇒ `count > 0` 恒假 ⇒
   * 这段提示在同一条 run 的第二次授权上从未出现过。修法不是把本地状态留住（那是给同一个
   * 事实再加一处声明），而是让它只有服务端一处：`AgentRunView.permissionDecisions` 由
   * `agent_runs.permission_decision_count` / `last_permission_decision` 下发，刷新、换标签页、
   * 冷启动读到的都是同一个数。老快照缺字段时回落到 0（= 不显示），绝不编一个次数出来。
   */
  const history = run?.permissionDecisions ?? { count: 0, last: null };
  React.useEffect(() => {
    if (!fallbackInterrupt || fallbackWasPending) return;
    const pendingInterrupt = run?.pendingApproval?.interrupt;
    if (!pendingInterrupt) return;
    if (pendingInterrupt.toolName === fallbackInterrupt.toolName
      && pendingInterrupt.args.requestId === fallbackInterrupt.args.requestId) setFallbackWasPending(true);
  }, [run, fallbackInterrupt, fallbackWasPending]);
  const decide = async (decision: "once" | "run" | "forever" | "deny") => {
    if (!canWrite || !request?.permissionRequestId || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    try {
      await apiRequest(planPermissions.operations.decidePermissionRequest.path.replace(":runId", encodeURIComponent(runId)).replace(":permissionRequestId", encodeURIComponent(request.permissionRequestId)), { method: "POST", body: { decision }, sessionToken: bearer });
      setConsumedRequestId(request.permissionRequestId);
      setRun(await getAgentRun(runId, bearer));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); }
    finally { inFlight.current = false; setPending(false); }
  };
  const decideFromCard = (decision: ToolPermissionCardDecision): void => {
    void decide(decision === "always" ? "forever" : decision);
  };
  const decideForm = async (decision: "approve" | "edit" | "reject", editedArgs?: Record<string, unknown>) => {
    if (!canWrite || !request?.permissionRequestId || inFlight.current) return;
    inFlight.current = true;
    setPending(true); setError(null);
    try {
      await apiRequest(wave2Runtime.operations.decideAgentRun.path.replace(":runId", encodeURIComponent(runId)), { method: "POST", body: { permissionRequestId: request.permissionRequestId, decision, ...(decision === "edit" ? { editedArgs } : {}) }, sessionToken: bearer });
      setConsumedRequestId(request.permissionRequestId);
      setRun(await getAgentRun(runId, bearer));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试"); }
    finally { inFlight.current = false; setPending(false); }
  };
  if (run && ["succeeded", "failed", "cancelled"].includes(run.status)) return null;
  if (fallbackInterrupt && request?.interrupt && (fallbackInterrupt.toolName !== request.interrupt.toolName || fallbackInterrupt.args.requestId !== request.interrupt.args.requestId)) return <fieldset disabled aria-label="已结束的确认记录"><RestoredInterruptForm interrupt={fallbackInterrupt} pending={false} decide={async () => {}} /></fieldset>;
  if (request?.permissionRequestId && request.permissionRequestId === consumedRequestId) return null;
  if (request?.interrupt && run?.status === "awaiting_tool_permission") return <section data-testid="restored-run-approval">{error ? <p role="alert">{error}</p> : null}{request.permissionRequestId ? <InterruptDecisionDialog key={request.permissionRequestId} interrupt={request.interrupt} pending={!canWrite || pending} decide={decideForm} /> : <fieldset disabled><RestoredInterruptForm interrupt={request.interrupt} pending={false} decide={async () => {}} /></fieldset>}</section>;
  // issue #3244 ①：已被裁决的那一份，只留痕、不再问（判据见 `fallbackWasPending` 头注）。
  if (fallbackInterrupt && !request?.interrupt && fallbackWasPending) return <fieldset disabled aria-label="已结束的确认记录"><RestoredInterruptForm interrupt={fallbackInterrupt} pending={false} decide={async () => {}} /></fieldset>;
  if (fallbackInterrupt && !request?.interrupt) return <section data-testid="interrupt-awaiting-persistence">
    <p role="status">{error ?? "等待服务端确认此请求，确认后即可继续。"}</p>
    <fieldset disabled><RestoredInterruptForm interrupt={fallbackInterrupt} pending={false} decide={async () => {}} /></fieldset>
  </section>;
  // 任何没有可恢复表单（三个具名中断）的 L2 工具——`call_skill`、`wx_canvas_update`、
  // `task` 等按 `tool-risk-tier.ts` 兜底为 L2 的工具——都走下面的授权卡。此前这里只放行
  // `call_skill`，其余工具只渲染一句"无法恢复"的 alert（还挂在线程顶部），run 停在
  // `awaiting_tool_permission` 却没有任何人能裁决；服务端 `decidePermissionRequest`
  // 本来就接受所有非表单工具。
  if (!error && (run?.status !== "awaiting_tool_permission" || !request)) return null;
  return <section
    data-testid="restored-run-approval"
    className="my-3"
    aria-label="等待工具审批"
  >
    <Button variant="outline" onClick={() => setPermissionOpen(true)}>打开工具审批</Button>
    <Dialog open={permissionOpen} onOpenChange={setPermissionOpen}>
      <DialogContent data-testid="chat-tool-permission-dialog" className="max-w-lg border-none bg-transparent p-0 shadow-none" hideClose onCloseAutoFocus={returnPermissionFocus}>
        <DialogTitle className="sr-only">审批高风险操作</DialogTitle>
        <DialogDescription className="sr-only">检查操作范围与参数，然后选择授权范围或拒绝。</DialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        {!request?.permissionRequestId ? <p className="text-sm">等待服务端恢复审批请求。</p> : null}
        {history.count > 0 && request?.permissionRequestId ? <p
          role="status"
          data-testid="perm-repeat-notice"
          className="mb-2 rounded-control bg-muted p-2 text-12 text-muted-foreground"
        >
          这是本次任务里第 {history.count + 1} 次请求授权，是一次新的请求，不是上一次没生效。
          {history.last === "once"
            ? "你上次选的是「仅本次允许」——那一档只对那一次调用生效，所以这次要重新确认。想一次性放行，可选「本 run 内都允许」。"
            : history.last === "deny"
              ? "你上次选的是「拒绝」——agent 据此换了做法，这是它提出的另一个操作。"
              : "上一次的授权不覆盖这次的操作，因此需要你再确认一次。"}
        </p> : null}
        {request ? <fieldset
          data-testid="chat-task-workbench-approval-card"
          data-risk="L2"
          disabled={!canWrite || pending || !request.permissionRequestId}
        >
          <ToolPermissionCard
            request={permissionCardRequest(request.toolName, request.argsSummary)}
            decided={null}
            onDecide={decideFromCard}
          />
        </fieldset> : null}
      </DialogContent>
    </Dialog>
  </section>;
}
