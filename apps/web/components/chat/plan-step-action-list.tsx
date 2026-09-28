"use client";
import * as React from "react";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import type { PlanStepAction } from "@/lib/chat-workbench/trace-plan";
import { toolLabel, toolObject } from "@/lib/chat-workbench/tool-label";

/**
 * 右栏「进度」页签里，一步计划下面做过的动作（2026-09-27 计划显示统一）。
 *
 * 三处计划各讲一件事：底部面板讲「进行到哪 + 控制」，消息流讲「本轮结束时的计划」，
 * 这里讲「这一步具体做了什么」——所以这里的独有内容是动作，不是再列一遍步骤。
 * 动作文案与执行过程同一份（`toolLabel` / `toolObject`），不另起一套措辞。
 *
 * 没有动作的步骤什么都不画：待开始的步骤本来就没有动作，不编一句「暂无」占位。
 */
export function PlanStepActionList({ todo, actions }: { todo: PlanTodo; actions: readonly PlanStepAction[] }): JSX.Element | null {
  if (actions.length === 0) return null;
  return (
    <details className="pl-5 text-11 text-muted-foreground" data-testid="chat-task-workbench-plan-step-actions" open={todo.status === "in_progress"}>
      <summary className="cursor-pointer rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {actions.length} 个动作
      </summary>
      <ul className="mt-1 space-y-0.5">
        {actions.map((action) => {
          const object = action.kind === "tool" ? toolObject(action.tool, action.args) : null;
          return (
            <li key={action.id} className="truncate" data-testid="chat-task-workbench-plan-step-action" data-status={action.status}>
              {action.kind === "skill" ? `技能 · ${action.tool}` : toolLabel(action.tool)}
              {object ? ` · ${object}` : ""}
              {action.status === "failed" ? " · 失败" : action.status === "running" ? " · 进行中" : ""}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
