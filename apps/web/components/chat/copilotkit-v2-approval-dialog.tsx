"use client";

import * as React from "react";
import { deepAgentHitl } from "@repo/contracts";
import { Pencil } from "lucide-react";
import { announceToChat } from "@/components/chat/chat-live-announcer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `copilotkit-v2-panel.tsx` 拆出，
 * 只是搬家：`SendEmailApprovalDialog` 只消费 props（`statusLabel`/`awaitingDecision`/
 * `args`/`respond`），不闭包依赖 `CopilotKitV2PanelBody` 的任何内部状态，是天然可
 * 独立成文件的一块。原文件当时已过 2000 行的业务源文件规模上限（AGENTS.md 硬约束），
 * 这是拆分的第一批。行为逐字节未变，唯一改动是文件边界与 import 路径。
 *
 * ── DA-19d 人在环（issue #1987，backlog DA-19d，框架版 Gap 3）─────────────────
 *
 * `useHumanInTheLoop`（`@copilotkit/react-core/v2` 自带 skill
 * `references/human-in-the-loop.md`，本节按其"Setup"范例照做，不凭记忆写 API）
 * 替换旧手写 `agent-approval-panel.tsx`（PR #1933，走 REST `/agent-runs/:runId/
 * decision`）——这里不是另建一套 approve/reject/edit 状态机：`respond` 由框架
 * 合成，本组件只在三种 `status`（`"inProgress" | "executing" | "complete"`，
 * camelCase，不是 `"in-progress"`）下渲染对应 UI，`respond()` 之外没有任何本地
 * 状态机分支去"预测"裁决结果——同一份纪律 `agent-approval-panel.tsx` 头注写过一次
 * （409 时如实展示服务端话术，不本地假装生效），这里由框架的 Promise 语义自动保证：
 * 不调用 `respond` 就是"没有决定"，run 就应该一直停在 `executing`，不存在本组件
 * 自己乐观更新出一个"已批准"的中间态。
 *
 * `parameters` 的 zod schema（`{to, subject, body}`）与 `name`（`"send_email"`）
 * 逐字对齐 `loopback-deep-agent-provider.ts` 的 `APPROVAL_TOOL_NAME`/`originalArgs`
 * 形状（该脚本头注"UX-9 D4 前端接入取证"一段）——沿用既有确定性替身的工具名，
 * 不是本次新发明一个后端不认识的工具。UI-kit 检测规则（human-in-the-loop.md 明写）：
 * 本仓已有 shadcn `Dialog`（`@/components/ui/dialog`，无 `AlertDialog` 分量），
 * 复用它而不是手写一个 `position:fixed` 遮罩层。
 *
 * ⚠ **DA-19g HITL 审批语义任务修复前的真实后端缺口**（历史记录，如实保留——完整
 * 机制与真实 wire 字节曾见 `e2e/copilotkit-v2-hitl.spec.ts` 头注旧版）：`send_email`
 * 的 `TOOL_CALL_START`/`_ARGS`/`_END` 确实会到达前端，但 `copilotkit-agui.
 * controller.ts` 的 `writeToolCallStep` 曾经对一个**还没被裁决**的步骤
 * （`RunStepPublic.status === "in_progress"`）与一个**已经成功**的步骤走同一个
 * `else` 分支，立刻补发一个内容为空字符串的 `TOOL_CALL_RESULT`——`useHumanInTheLoop`
 * 借以判定"这个工具调用还在等人"的信号（`TOOL_CALL_END` 之后一段时间内没有配对结果）
 * 因此从未成立，客户端把它当已完成处理，`status` 直接落 `"complete"`，从未经过
 * `"executing"`：`respond` 全程 `undefined`，approve/编辑/reject 三个按钮永远不会
 * 渲染；run 自己的**整体**状态仍卡在 `awaiting_approval`，`runAguiBridgeTurn` 的
 * 轮询循环只认 `"succeeded"`/`"failed"` 两个终态分支，最终耗尽 `maxPolls`（~30s）以
 * `RUN_ERROR`/`AGENT_RUN_TIMEOUT` 收场——也没有任何入口能把 `respond()` 之后框架
 * 发起的 follow-up `runAgent` 请求路由回同一个被打断的 run 去恢复它。
 *
 * **已修复**（DA-19g HITL 审批语义任务）：`writeToolCallStep` 现在对 `"in_progress"`
 * 步骤只发 `STEP_STARTED`→`TOOL_CALL_START/ARGS/END`，不再提前发 `RESULT`/
 * `STEP_FINISHED`——`useHumanInTheLoop` 的"等待"信号成立，`respond` 真的落在
 * `"executing"`。`runAguiBridgeTurn`（`apps/api/src/application/agent-run/
 * agui-bridge.ts`）认识 `awaiting_approval` 这个中间态，以真实的 `RUN_FINISHED`
 * （不是超时/错误）结束这一轮，与一次真正的 AG-UI 前端工具调用同一个协议约定。新增
 * 的 `resumeAguiBridgeTurn` + `copilotkit-agui.controller.ts` 的
 * `isHitlResumeRequest`/`parseHitlDecision` 把 `respond()` 之后的 follow-up
 * `runAgent` 请求（`{role:"tool", toolCallId, content}` 消息 + `forwardedProps.
 * chatThreadId`）路由回同一个被打断的 run，复用 DA-07b 的 `decideAgentRun`（旧 REST
 * `/agent-runs/:runId/decision` 路径的同一套底层机制，不是重新发明一套）去 resume
 * 它。本文件（`useHumanInTheLoop` 接线，见 `copilotkit-v2-panel.tsx`）没有改一行——
 * DA-19d 当时的接线已经跟旧面板逐条对齐，后端补上之后立刻工作。真实浏览器三条路径的
 * 证据见 `e2e/copilotkit-v2-hitl.spec.ts`（approve/edit/reject 各一条用例）。
 */

/**
 * ⚠ **这两个值不在本文件声明** —— 唯一事实源是 `@repo/contracts` 的 `deep-agent-hitl.ts`
 * （issue #2017）。这里只是把它取出来用，供 `copilotkit-v2-panel.tsx` 的
 * `useHumanInTheLoop({ name: APPROVAL_TOOL_NAME, parameters: approvalToolParameters, render })`
 * 接线消费。
 *
 * 曾经这里写死 `"send_email"` 加 `{to, subject, body}`。那个名字在
 * `apps/deep-agent-service` 全树 grep **零命中**——它只是 e2e 确定性替身
 * （`loopback-deep-agent-provider.ts`）自己的剧本。真实引擎中断在
 * `call_skill` 上，桥原样转发引擎的真实工具名（`copilotkit-agui.controller.ts`
 * 的 `writeToolCallStep`，`toolCallName: step.toolName`，不改名不过滤），于是
 * 名字对不上 ⇒ `useHumanInTheLoop` 不认领这次调用 ⇒ 渲染成普通工具卡、
 * `respond` 恒 `undefined` ⇒ 三个决策按钮永远不出现 ⇒ run 停在
 * `awaiting_approval` 无人能裁决。这就是 `DEEP_AGENT_HITL_TOOLS` 此前不敢打开的原因。
 *
 * 修法**不是**把写死的错名字换成写死的对名字（那是下一次漂移的种子），而是让前端、
 * e2e 替身、部署开关三处全部从契约派生。改名字请改契约文件，不要改这里。
 */
export const APPROVAL_TOOL_NAME = deepAgentHitl.DEEP_AGENT_HITL_TOOL_NAME;
export const approvalToolParameters = deepAgentHitl.DeepAgentHitlToolArgs;

/**
 * 编辑态的 JSON 文本域校验纪律与 `agent-approval-panel.tsx` 的 `parsedDraft` 逐条
 * 一致（必须是合法 JSON **对象**，不是数组/原始值）——同一份产品纪律换一层框架
 * 实现，不因为换了 hook 就放松校验。
 */
/**
 * issue #2692 —— 审批弹窗的工具名早已从写死的 `send_email` 通用化为
 * `deepAgentHitl.DEEP_AGENT_HITL_TOOL_NAME`（值是 `call_skill`，见上面
 * `APPROVAL_TOOL_NAME` 的头注），但本组件的文案当时没跟着改，四处仍硬编码
 * 「发送邮件」——于是生成 PDF（走 `call_skill` 调用某个 PDF 技能，`args.
 * skill_stable_name` 不是 `send_email`）时也弹出「等待批准：发送邮件」，
 * 文案和用户实际在批准的动作对不上。
 *
 * 修法：文案从 `args.skill_stable_name`（`DeepAgentHitlToolArgs` 的真实字段，
 * 见 `@repo/contracts` 的 `deep-agent-hitl.ts`）派生，不再写死某一个技能的名字；
 * 取不到时退化为通用的「调用技能」而不是猜一个具体动作名。
 */
function describeSkillAction(args: Record<string, unknown>): string {
  const name = args.skill_stable_name;
  return typeof name === "string" && name.length > 0 ? `调用技能：${name}` : "调用技能";
}

function parseEditDraft(draft: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const value: unknown = JSON.parse(draft);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, message: "编辑后的参数必须是 JSON 对象（不能是数组或原始值）" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, message: "不是合法 JSON，请修正后再提交" };
  }
}

/**
 * `useHumanInTheLoop` 的 `render` —— 三态齐全（`inProgress`/`executing`/
 * `complete`），`respond` 只在 `"executing"` 下非 `undefined`（human-in-the-loop.md
 * "Common Mistakes" 明确警告：把它 widen 成 `any` 会静默 no-op，按钮点了但 Promise
 * 永不 resolve）——本组件在其余两态直接 return 一段只读文案，从不把 `respond` 从
 * 闭包外传出去，物理上排除了"在错误状态下调用它"的可能。
 */
export function SendEmailApprovalDialog({
  statusLabel,
  awaitingDecision,
  args,
  respond,
}: {
  /** 只读文案 + `data-hitl-status` 探针用的原始状态字符串（`"inProgress"` /
   *  `"executing"` / `"complete"`，直接取自 `ToolCallStatus` 枚举的字符串值，
   *  不重新声明一份易漂移的联合类型）。 */
  statusLabel: string;
  /** `respond !== undefined` 的等价布尔值——在这一层拆开是为了不用把
   *  `ToolCallStatus`（`@copilotkit/core` 的枚举类型）也吃进这个纯展示组件的
   *  类型签名，`render` 回调里已经用真实枚举值判过一次，这里只消费判完的结果。 */
  awaitingDecision: boolean;
  args: Record<string, unknown>;
  respond?: (result: unknown) => void;
}): JSX.Element | null {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  /**
   * DA-19g fix（issue #1996）—— `open` must be a REAL controlled boolean, never
   * a hardcoded literal `true`. The pre-fix version rendered `<Dialog open>`
   * with **no** `onOpenChange` in *both* branches below; Radix has no state to
   * flip when its default close icon / Escape / overlay-click fires, so the
   * portal-rendered overlay (`fixed inset-0 z-50 bg-inverse/40 backdrop-blur-sm
   * ...`, see `ui/dialog.tsx` `DialogOverlay`) stayed mounted forever. Because
   * the HITL tool-call message that hosts this component is never
   * pruned from `agent.messages`, that overlay became a permanent
   * click-blocker over the whole panel the moment any HITL flow reached its
   * terminal read-only branch (185-retry Playwright timeout; see
   * `.harness/state/copilotkit-v2-ux-acceptance-score.md` 判据 #10 / #7 / #9).
   *
   * `dismissed` is the single source of truth for "should this component still
   * render a blocking modal" — once set, the component returns `null` (no
   * `Dialog`, no portal, nothing to leak) regardless of `status`/`awaitingDecision`.
   * It is set from three independent close paths so there is no way to end up
   * stuck again: (1) Radix's own `onOpenChange(false)` (Escape / overlay click /
   * built-in close icon), (2) the explicit "关闭" button on the read-only
   * terminal branch (Radix's default icon alone is not enough — see
   * human-in-the-loop.md 提醒 "Common Mistakes"), (3) any of the interactive
   * approve/reject/edit-submit actions, which already resolve `respond(...)`.
   */
  const [dismissed, setDismissed] = React.useState(false);
  const close = React.useCallback(() => setDismissed(true), []);

  const startEditing = (): void => {
    setDraft(JSON.stringify(args, null, 2));
    setEditing(true);
  };

  /**
   * issue #2075（TW-A11Y-4）—— 「需要你批准」必须被播报。这是整条链路上最需要
   * 播报的一刻：不播报，屏幕阅读器用户根本不知道系统正在等他做决定，主观上就是卡死。
   */
  React.useEffect(() => {
    if (awaitingDecision) announceToChat(`需要你的批准：${describeSkillAction(args)}。请在审批对话框中选择批准、编辑或拒绝。`);
  }, [awaitingDecision, args]);

  /**
   * issue #2075（TW-A11Y-5「关闭后焦点归位」）—— 真栈实测：关掉审批弹窗后
   * `document.activeElement` 是 **`BODY`**，键盘用户被扔回文档开头，丢掉全部上下文。
   *
   * 根因不是 Radix 没做焦点恢复，而是**它记下的那个"原焦点"本身已经失效**：
   * 用户点「发送」→ `agent.isRunning` 变真 → 发送按钮 `disabled` → 浏览器把焦点
   * 从这个被禁用的按钮收回给 `body`；弹窗随后才异步出现，Radix 记下的就是 `body`。
   * 于是"忠实地恢复原焦点"= 恢复到 body。**静态地读这段代码看不出问题**，
   * 只有活体跑才会暴露——这条正是 #2068 基线里点名的那个真实可达性缺陷。
   *
   * 修法：`onCloseAutoFocus` 里接管，把焦点还给 composer 输入框——那是用户在这条
   * 对话里"正在工作的地方"，比一个已经禁用的发送按钮更是他要回去的位置。
   */
  const focusComposer = React.useCallback((): void => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    composer?.focus();
  }, []);

  const returnFocusToComposer = React.useCallback((event: Event) => {
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    if (composer === null) return; // 找不到就让 Radix 走它的默认恢复，别把焦点弄丢
    event.preventDefault();
    composer.focus();
  }, []);

  /**
   * ⚠ 光有 `onCloseAutoFocus` **不够**——issue #2075 第四轮真栈实测：改完之后焦点
   * **仍然**落在 `BODY`。原因是这条链路上关闭不只有 Radix 那一条路径：Esc 触发
   * `respond("denied")` 之后框架会把整个 tool-render 子树摘掉，`DialogContent` 是被
   * **卸载**的，Radix 的关闭序列（连同 `onCloseAutoFocus`）根本没有机会跑完；
   * 而 Radix 的 FocusScope 在卸载时会把焦点恢复到它记下的那个元素——那个元素正是
   * 已经失效的 `body`。
   *
   * 所以再补一条与 Radix 无关的兜底：`close()` 时排两帧之后主动把焦点交回 composer。
   * 两帧（而不是一帧）是刻意的——要落在 Radix 自己那次恢复**之后**，否则我们先设、
   * 它后覆盖，结果和没改一样。两条路径设的是同一个目标元素，不冲突。
   */
  const closeAndReturnFocus = React.useCallback((): void => {
    close();
    requestAnimationFrame(() => requestAnimationFrame(focusComposer));
  }, [close, focusComposer]);

  if (!awaitingDecision || respond === undefined) {
    return (
      /* `open={!dismissed}` 而不是 `if (dismissed) return null` + `open`：
         直接 return null 会让 Radix 的关闭序列整个不发生，`onCloseAutoFocus` 也就
         永远不触发（焦点归位无从谈起）。受控 `open` 同样不残留遮罩——portal 内容
         在 `open=false` 时本来就不挂载，#1996 那条"永久点击拦截层"不会回来。 */
      <Dialog open={!dismissed} onOpenChange={(next) => { if (!next) closeAndReturnFocus(); }}>
        <DialogContent
          data-testid="copilotkit-v2-hitl-dialog"
          data-hitl-status={statusLabel}
          onCloseAutoFocus={returnFocusToComposer}
        >
          <DialogHeader>
            <DialogTitle>等待批准：{describeSkillAction(args)}</DialogTitle>
            <DialogDescription>
              {statusLabel === "inProgress" ? "工具调用参数正在流式到达…" : "本轮已裁决，等待 run 收尾。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" data-testid="copilotkit-v2-hitl-dismiss" onClick={closeAndReturnFocus}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const parsedDraft = parseEditDraft(draft);

  return (
    <Dialog
      open={!dismissed}
      onOpenChange={(next) => {
        // 用户通过 Escape/点遮罩层/默认关闭图标退出时，等价于「拒绝」——不这样
        // 处理的话，Dialog 会正确卸载（不再残留遮罩），但框架合成的 respond
        // Promise 永远不会 resolve（human-in-the-loop.md "No respond call →
        // infinite hang"），run 会一直挂到后端自己的轮询超时才收场，属于
        // "看起来关掉了、实际状态没跟上"的另一种不一致，不是本次要放行的行为。
        if (!next) {
          closeAndReturnFocus();
          respond("denied");
        }
      }}
    >
      <DialogContent
        data-testid="copilotkit-v2-hitl-dialog"
        data-hitl-status={statusLabel}
        onCloseAutoFocus={returnFocusToComposer}
      >
        <DialogHeader>
          <DialogTitle>等待你的批准：{describeSkillAction(args)}</DialogTitle>
          <DialogDescription>批准前可编辑下方参数，裁决后由框架恢复这次 run。</DialogDescription>
        </DialogHeader>
        {!editing ? (
          <div className="flex flex-col gap-1">
            {/* issue #2039（第 3 轮 gap #5 的一半）——参数块加一个说明标签，
                不再是一坨无标题 JSON 直接怼在标题下面。 */}
            <p className="text-10 font-medium text-muted-foreground">工具参数（JSON）</p>
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-subtle bg-muted px-2 py-1.5 text-11 text-muted-foreground"
              data-testid="copilotkit-v2-hitl-args"
            >
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        ) : (
          <div>
            <textarea
              className="h-40 w-full resize-y rounded border border-input bg-muted px-2 py-1 font-mono text-11 text-foreground"
              data-testid="copilotkit-v2-hitl-edit-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            {!parsedDraft.ok ? (
              <p className="mt-1 text-11 text-destructive" data-testid="copilotkit-v2-hitl-edit-json-error">
                {parsedDraft.message}
              </p>
            ) : null}
          </div>
        )}
        <DialogFooter className="gap-2">
          {!editing ? (
            <>
              <Button
                size="sm"
                data-testid="copilotkit-v2-hitl-approve"
                onClick={() => {
                  closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
                  respond("approved");
                }}
              >
                批准并继续
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="copilotkit-v2-hitl-start-edit"
                onClick={startEditing}
              >
                <Pencil aria-hidden className="h-3 w-3" />
                编辑参数
              </Button>
              {/* issue #2039（第 3 轮 gap #5 的另一半）——「拒绝」带 destructive
                  语义色（outline 形态 + 红字），与「批准并继续」的 primary 拉开
                  层级；此前三个按钮两个长得一模一样。 */}
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive transition-colors duration-fast hover:bg-destructive/10 hover:text-destructive"
                data-testid="copilotkit-v2-hitl-reject"
                onClick={() => {
                  closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
                  respond("denied");
                }}
              >
                拒绝
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={!parsedDraft.ok}
                data-testid="copilotkit-v2-hitl-edit-submit"
                onClick={() => {
                  if (parsedDraft.ok) {
                    closeAndReturnFocus(); // 裁决完也要把焦点交回 composer（TW-A11Y-5）
                    respond(parsedDraft.value);
                  }
                }}
              >
                编辑并批准
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="copilotkit-v2-hitl-edit-cancel"
                onClick={() => setEditing(false)}
              >
                取消
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
