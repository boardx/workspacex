"use client";

import * as React from "react";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { agentInterrupts } from "@repo/contracts";
import { ConfirmIntentCard } from "@/components/agent-interrupts/confirm-intent-card";
import { FillParamsCard } from "@/components/agent-interrupts/fill-params-card";
import { ChooseOptionCard } from "@/components/agent-interrupts/choose-option-card";
import { InterruptCardShell } from "@/components/agent-interrupts/interrupt-card-shell";
import type { ParamField as PreviewParamField } from "@/lib/agent-interrupts-types";
import type { UiState } from "@/components/state/state-shell";

/**
 * issue #2179 —— F212/F213 已建成的三张 HITL 中断卡（`components/agent-interrupts/`）
 * 接入 `copilotkit-v2-panel.tsx` 的真实聊天渲染树。
 *
 * ## 为什么是独立文件，不是加进 `copilotkit-v2-panel.tsx` 的既有 `useHumanInTheLoop` 调用
 *
 * 那个文件已经 2607+ 行、多条在途分支同时改动（AGENTS.md 文件规模纪律）。`useHumanInTheLoop`
 * 与 `useRenderTool`/`useDefaultRenderTool`（`copilotkit-v2-tool-renderers.tsx` 已用同一模式）
 * 一样，本质是「渲染 `null`、副作用是往 `CopilotKit` provider 的全局登记表里插一行」的
 * hook——不需要跟既有 `send_email` 那条注册挤在同一个函数组件里，只需要是
 * provider 子树里的**某个**组件（`copilotkit-v2-tool-renderers.md` 头注："挂载顺序不敏感：
 * 三个 hook 各自 `useEffect` 注册，与 `CopilotKitV2Panel` 是否已经挂载无关"，对
 * `useHumanInTheLoop` 同样成立——两者共享同一条 `registerRenderer` 登记机制，`dist/
 * copilotkit-D0aAnD3i.d.mts` 里 `ReactHumanInTheLoop` 就是 `Omit<FrontendTool<T>, "handler">`，
 * 走的是同一张 `humanInTheLoop`/`frontendTools` 登记表，不是两套隔离的上下文）。
 * 本组件与 `<CopilotKitV2ToolRenderers />` 挂在 `copilotkit-v2-panel.tsx` 同一处
 * （紧邻 `<CopilotKitV2ToolRenderers />`），渲染 `null`。
 *
 * ## respond(...) 的协议——不是把契约的判别式联合直接 JSON 化发出去
 *
 * 桥接层（`copilotkit-agui.controller.ts` 的 `parseHitlDecision`）是**工具名无关**的通用
 * 三态协议，早在 `send_email`/`call_skill`（DA-19d/DA-19g）就定型、F213（#2177）confirm_intent
 * 接线原样复用：
 *   - 字面量字符串 `"approved"` / `"denied"`
 *   - 或一个**原始对象**——被无条件解释成 `{kind:"edit", editedArgs: <这个对象本身>}`
 *
 * 这不是本文件的判断题，是 `agent-interrupts.ts` 契约文件自己在 UC-3 段落写明的既有事实
 * （"前端以 `respond(JSON.stringify({ selectedOptionId }))` resume……桥接层既有的『raw JSON
 * → edit』分支原样吃下，零改动"）——`ConfirmIntentDecision`/`FillParamsDecision`/
 * `ChooseOptionDecision` 这三个判别式联合是**领域模型**（后续 F214-F216 后端裁决逻辑、
 * Python 侧消费的形状），不是这一层要在线上发送的**信封**格式；本文件把领域决策拆成
 * "approve → 发字符串" / "edit → 发 editedArgs 那一半原始对象（拍平，不带外层
 * `{decision, editedArgs}` 包装）"两类，落地跟 `SendEmailApprovalDialog` 的
 * `respond("approved")` / `respond(parsedDraft.value)` 完全同一套写法。
 *
 * ## 三态映射——`inProgress`/`complete` 没有交互，只有 `executing` 渲染真实可操作卡片
 *
 * 与 `SendEmailApprovalDialog` 同一条纪律（`respond` 只在 `"executing"` 下非 `undefined`，
 * human-in-the-loop.md "Common Mistakes"）：
 *   - `inProgress`：参数还在流式组装，`args` 是 `Partial<T>`，不满足卡片的完整 props 类型
 *     （例如 `ConfirmIntentArgs.assumptions` 可能还没到齐），走 `StateShell` 的 `loading` 骨架，
 *     不把不完整对象硬塞给卡片。
 *   - `executing`：`args` 已完整、`respond` 可用——渲染真实交互卡片。
 *   - `complete`：已裁决，`respond` 恒 `undefined`——渲染一句只读收尾文案，不重新渲染
 *     一遍已经过时的交互控件（同一张卡片此时不再代表"待决"）。
 */

/** `FillParamsArgs.fields` 是契约里的 `ParamField`（不带 `kind`/`options`）——
 *  这两个字段是 mock 文件为预览渲染引入的**展示层扩展**，真实契约不携带控件类型信息
 *  （如实记录的现状缺口，非本轮扩大范围：契约要补 `kind` 需要走契约修订，不是这里
 *  悄悄堵上）。这里退而求其次按值类型推断控件：布尔值走 checkbox，其余一律 text——
 *  `select` 没有推断依据（缺 `options`），这条路径下永远不会渲染成下拉选择。 */
function toPreviewParamField(f: agentInterrupts.ParamField): PreviewParamField {
  const sample = f.aiGuess ?? f.currentValue;
  return { ...f, kind: typeof sample === "boolean" ? "boolean" : "text", options: undefined };
}

function ReadOnlyResolved({ testid, title, note }: { testid: string; title: string; note: string }) {
  return (
    <InterruptCardShell testid={testid} title={title} subtitle={note}>
      <p className="text-11 text-muted-foreground" data-testid={`${testid}-resolved`}>
        本次裁决已提交，等待 run 收尾。
      </p>
    </InterruptCardShell>
  );
}

/**
 * issue #2779 —— 与 `copilotkit-v2-approval-dialog.tsx` 的 `liveSeenApprovalToolCallIds`
 * 同一条纪律（那份文件的头注有完整复现记录，这里不重复）：`useHumanInTheLoop` 的
 * `render` 对线程历史里**任何一条**待批工具调用消息都会调用一遍，不区分"这是本次
 * 会话刚发生的交互"还是"翻出一条早就结束的裁决"。这三张卡片是行内只读文案（不像
 * `SendEmailApprovalDialog` 那样弹全屏模态框挡住 composer），后果没那么严重，但同一
 * 个假象仍然成立：用户重新打开一条早就跑完的线程，看到"确认一下我的理解，再开始"
 * 配一句"已裁决，等待 run 收尾"——这句话字面意思是"还在等"，而真实情况是这个 run
 * 可能几天前就已经收尾（成功或失败），这句话对翻旧账的场景是**假的**、误导性的。
 *
 * 修法与 approval-dialog 那份完全同构：只有这个 `toolCallId` 在本标签页会话里被
 * 观察到过未决态（`inProgress`/`executing`），`complete` 分支才渲染这张"已裁决，
 * 等待 run 收尾"卡片；否则（=从未在本标签页观察到未决态，只可能是翻线程历史）
 * 直接不渲染，不给一句可能早就过期的"等待中"文案。
 */
const liveSeenInterruptToolCallIds = new Set<string>();

/**
 * issue #2858（devapp 2026-09-06 实测）—— 用户点了「继续」/「接受」之后，run 继续跑几十秒
 * 到几分钟，这段时间 `useHumanInTheLoop` 给这条 toolCall 的 `status` 不是 `complete`
 * （结果要等 run 收尾才回来），而 `respond` 已经用掉 ⇒ 落进上面"非 executing"分支的
 * `loading` 骨架——用户看到自己刚确认过的卡片变成一排灰块，以为页面坏了。
 * 这里按 toolCallId 记"本标签页已裁决"，裁决过的一律渲染「已裁决，等待 run 收尾」，
 * 与 `complete` 分支同一张只读卡；纯本地记忆，不改协议。
 */
const respondedInterruptToolCallIds = new Set<string>();

function respondOnce<T>(toolCallId: string, respond: (payload: T) => void): (payload: T) => void {
  return (payload) => {
    respondedInterruptToolCallIds.add(toolCallId);
    respond(payload);
  };
}

/** 三张卡片共用：在 `render` 里先记一次"是否观察到未决态"，再判断这次
 *  `"complete"` 渲染是不是翻旧账。纯函数，不是 Hook，`render` 三处都能直接调用。 */
function isStaleHistoricInterruptReplay(toolCallId: string, status: string): boolean {
  if (status !== "complete") liveSeenInterruptToolCallIds.add(toolCallId);
  return status === "complete" && !liveSeenInterruptToolCallIds.has(toolCallId);
}

export function CopilotKitV2AgentInterrupts(): null {
  useHumanInTheLoop<agentInterrupts.ConfirmIntentArgs>(
    {
      name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
      description: "执行前复述对任务的理解与假设，等待用户确认或修改假设",
      parameters: agentInterrupts.ConfirmIntentArgs,
      render: ({ toolCallId, status, args, respond }) => {
        if (status !== "executing" || respond === undefined) {
          const state: UiState = status === "inProgress" ? "loading" : "default";
          if (isStaleHistoricInterruptReplay(toolCallId, status)) return null;
          return status === "complete" || respondedInterruptToolCallIds.has(toolCallId) ? (
            <ReadOnlyResolved
              testid="agent-interrupt-confirm-intent"
              title="确认一下我的理解，再开始"
              note="已裁决，等待 run 收尾。"
            />
          ) : (
            <ConfirmIntentCard
              args={{ requestId: "", understanding: "", assumptions: ["", ""] }}
              state={state}
              canWrite={false}
            />
          );
        }
        // issue #2842：模型偶尔把 assumptions 多编码成 JSON 字符串（API 侧已归一化，
        // `agent-interrupt-args.ts`）；这里再守一道——不是数组就退回骨架态，不让
        // `assumptions.map` 把整页掀进错误边界。
        if (!Array.isArray(args.assumptions)) {
          return (
            <ConfirmIntentCard
              args={{ requestId: "", understanding: "", assumptions: ["", ""] }}
              state="loading"
              canWrite={false}
            />
          );
        }
        return (
          <ConfirmIntentCard
            args={args}
            state="default"
            canWrite
            onContinue={() => respondOnce(toolCallId, respond)("approved")}
            onEditSubmit={(assumptions) => respondOnce(toolCallId, respond)({ assumptions })}
          />
        );
      },
    },
    [],
  );

  useHumanInTheLoop<agentInterrupts.FillParamsArgs>(
    {
      name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
      description: "开始前请人补全/确认 AI 猜测的运行参数",
      parameters: agentInterrupts.FillParamsArgs,
      render: ({ toolCallId, status, args, respond }) => {
        if (status !== "executing" || respond === undefined) {
          if (isStaleHistoricInterruptReplay(toolCallId, status)) return null;
          return status === "complete" || respondedInterruptToolCallIds.has(toolCallId) ? (
            <ReadOnlyResolved
              testid="agent-interrupt-fill-params"
              title="开始前，帮我确认几个参数"
              note="已裁决，等待 run 收尾。"
            />
          ) : (
            <FillParamsCard fields={[]} state="loading" canWrite={false} />
          );
        }
        if (!Array.isArray(args.fields)) {
          // issue #2842：同 confirm_task_intent 的守法——非数组退回骨架态，不崩页。
          return <FillParamsCard fields={[]} state="loading" canWrite={false} />;
        }
        return (
          <FillParamsCard
            fields={args.fields.map(toPreviewParamField)}
            state="default"
            canWrite
            onSubmit={(payload) =>
              payload.decision === "approve"
                ? respondOnce(toolCallId, respond)("approved")
                : respondOnce(toolCallId, respond)({ fields: payload.fields, appliedTo: payload.appliedTo })
            }
          />
        );
      },
    },
    [],
  );

  useHumanInTheLoop<agentInterrupts.ChooseOptionArgs>(
    {
      name: agentInterrupts.AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
      description: "展示 2-3 条推进方案，等待用户选择其中一条或都不选",
      parameters: agentInterrupts.ChooseOptionArgs,
      render: ({ toolCallId, status, args, respond }) => {
        if (status !== "executing" || respond === undefined) {
          if (isStaleHistoricInterruptReplay(toolCallId, status)) return null;
          return status === "complete" || respondedInterruptToolCallIds.has(toolCallId) ? (
            <ReadOnlyResolved
              testid="agent-interrupt-choose-option"
              title="有几条推进路线，选一条我就接着做"
              note="已裁决，等待 run 收尾。"
            />
          ) : (
            <ChooseOptionCard options={[]} state="loading" canWrite={false} />
          );
        }
        if (!Array.isArray(args.options)) {
          // issue #2842：同上。
          return <ChooseOptionCard options={[]} state="loading" canWrite={false} />;
        }
        return (
          <ChooseOptionCard
            options={args.options}
            state="default"
            canWrite
            onSelectConfirm={(selectedOptionId) => respondOnce(toolCallId, respond)({ selectedOptionId })}
            onDecline={() => respondOnce(toolCallId, respond)("denied")}
          />
        );
      },
    },
    [],
  );

  return null;
}
