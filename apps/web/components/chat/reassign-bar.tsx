"use client";
import * as React from "react";
import { X, ArrowLeftRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REASSIGN_SUGGESTION } from "@/lib/mock/chat";

/**
 * 改派建议条（UC-8.2 R3 步骤 11 / UC-4.2 R3 步骤 9）：
 * 判据是 MCP 授权集，理由必须写出**具体授权名**（不得只说「更合适」）。
 * 可关闭的轻量条幅，不打断输入；`改派` 主动作、`×` 忽略。改派是建议不是自动执行。
 * ⚠ 界面投影：`改派` 只做乐观反馈（本轮换 agent 回答），真实路由在服务端。
 */
export function ReassignBar() {
  const [dismissed, setDismissed] = React.useState(false);
  const [applied, setApplied] = React.useState(false);
  if (dismissed) return null;
  const s = REASSIGN_SUGGESTION;

  if (applied) {
    return (
      <div
        data-testid="chat-reassign-applied"
        className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-success"
      >
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <p className="min-w-0 flex-1 text-11">
          已改派给 <span className="font-medium">{s.targetAgent}</span> · 本轮由它回答（它{s.reason}）
        </p>
        <Button size="icon" variant="ghost" aria-label="关闭" onClick={() => setDismissed(true)} data-testid="chat-reassign-dismiss" className="h-6 w-6">
          <X aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-reassign-bar"
      className="flex items-center gap-2 rounded-md border border-ai/20 bg-ai-tint px-3 py-1.5 text-ai-tint-foreground"
    >
      <ArrowLeftRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1 text-11">
        这条更适合 {s.targetAgent}：它<span className="font-medium" data-testid="chat-reassign-reason">{s.reason}</span>，改派后本轮由它回答
      </p>
      <Button size="xs" variant="outline" onClick={() => setApplied(true)} data-testid="chat-reassign-apply">改派</Button>
      <Button size="icon" variant="ghost" aria-label="忽略改派建议" onClick={() => setDismissed(true)} data-testid="chat-reassign-dismiss" className="h-6 w-6">
        <X aria-hidden className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
