"use client";
import * as React from "react";
import { Check, Pause, Send, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AgentKernelRunStatus } from "@/lib/agent-kernel-stream";
import {
  classifyInterjectFailure, interjectAgentRun,
  INTERJECT_FAILURE_COPY, INTERJECT_UNKNOWN_FAILURE_COPY,
  type InterjectFn,
} from "@/lib/agent-kernel-interject";

/**
 * issue #2756 —— 本组件从 `agent-kernel-units.tsx` 原样搬出（行为、data-testid 逐字不变，
 * 该文件 `export { InterjectionComposer } from` 这里，既有 import 路径与 F12 测试不受影响）。
 *
 * 搬出的唯一理由：`/chat` 宿主要真实渲染它，而 `agent-kernel-units.tsx` 顶部整体
 * `import` 了 `@/lib/mock/agent-kernel`（其余签核原型单元的 mock 数据）。
 * `tests/session/chat-dead-mock-cluster.test.ts`（#462）机械禁止 `/chat` 路由闭包里出现
 * 任何指向 `lib/mock/**` 的边——本组件自身从不碰 mock，把它放进一个不引 mock 的文件，
 * 才是让「/chat 不吃 mock」这条不变量继续成立的正确做法，而不是给台账加豁免。
 */
// ══ 04 中途插话入口 ═════════════════════════════════════════════════
/**
 * Phase 14 F12（`artifacts-steering` 契约束 UC-4 / R3' / R8）—— run 处于 `running` 时的
 * 插话入口。真实发送走 `lib/agent-kernel-interject.ts`（F11 的
 * `POST /agent-runs/:runId/interject`）；`interject` 可注入替身供测试。
 *
 * - `runId` 缺省（`/preview/agent-kernel` 原型页）⇒ 不发请求，本地即时回显「已收到」——
 *   这是签核用原型的原始行为，保留给预览页；有 `runId` 才是真实路径。
 * - `status` 缺省视为 `running`。非 `running` ⇒ 输入框与发送键 disabled（契约
 *   `RUN_NOT_RUNNING` 是服务端的最终裁决，这里只是不让用户发一条注定被拒的请求）。
 * - 「已收到」的数据来源是响应里的 `receivedAt`（契约注释：服务端已接收即返回）；
 *   等待期间显示 `interjection-pending`，失败显示 `interjection-error` 并**保留**输入
 *   文本供重发。发送中输入框保持可交互（R8：运行中输入框非 disabled），只锁发送键
 *   防止重复提交。
 */
const ACK_VISIBLE_MS = 4_000;

export interface InterjectionComposerProps {
  readonly runId?: string | null;
  readonly status?: AgentKernelRunStatus;
  readonly interject?: InterjectFn;
  /** 供预览/宿主覆盖第一行提示；缺省给出通用文案。 */
  readonly hint?: string;
}

export function InterjectionComposer({
  runId = null, status = "running", interject = interjectAgentRun, hint,
}: InterjectionComposerProps = {}) {
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [ack, setAck] = React.useState<{ readonly text: string; readonly receivedAt: string | null } | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const ackTimer = React.useRef<number | null>(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (ackTimer.current !== null) window.clearTimeout(ackTimer.current);
    };
  }, []);

  const live = typeof runId === "string" && runId !== "";
  const canInterject = status === "running";

  const showAck = (text: string, receivedAt: string | null) => {
    setAck({ text, receivedAt });
    if (ackTimer.current !== null) window.clearTimeout(ackTimer.current);
    ackTimer.current = window.setTimeout(() => {
      if (mounted.current) setAck(null);
    }, ACK_VISIBLE_MS);
  };

  const send = async () => {
    const text = value.trim();
    if (!text || pending || !canInterject) return;
    setFailure(null);
    if (!live) {
      showAck(text, null);
      setValue("");
      return;
    }
    setPending(true);
    try {
      const out = await interject({ runId, text });
      if (!mounted.current) return;
      showAck(text, out.receivedAt);
      setValue("");
    } catch (e) {
      if (!mounted.current) return;
      const code = classifyInterjectFailure(e);
      setFailure(code ? INTERJECT_FAILURE_COPY[code] : INTERJECT_UNKNOWN_FAILURE_COPY);
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  const hintText = hint ?? (canInterject
    ? "agent 正在执行中。你可以随时插一句话调整方向，不会打断当前正在执行的这一步。"
    : `任务当前不在执行中（${status}），插话入口暂不可用。`);

  return (
    <div data-testid="interjection-composer" data-run-status={status} className="flex max-w-xl flex-col gap-2">
      <div className="flex items-center gap-2 rounded-card border border-border bg-card p-2 text-11 text-muted-foreground">
        {canInterject
          ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-primary" />
          : <Pause aria-hidden className="h-3.5 w-3.5" />}
        {hintText}
      </div>

      {ack && (
        <div
          role="status"
          data-testid="interjection-ack"
          data-received-at={ack.receivedAt ?? undefined}
          className="flex items-center gap-1.5 rounded-card border border-border bg-background p-2 text-12 text-background-foreground transition-opacity duration-slow"
        >
          <Check aria-hidden className="h-3.5 w-3.5 text-success" />
          已收到「{ack.text.length > 24 ? ack.text.slice(0, 24) + "…" : ack.text}」，会在下一步之前纳入考虑。
        </div>
      )}

      {pending && !ack && (
        <div
          role="status"
          data-testid="interjection-pending"
          className="flex items-center gap-1.5 rounded-card border border-border bg-background p-2 text-12 text-muted-foreground"
        >
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-primary" />
          正在发送插话…
        </div>
      )}

      {failure && (
        <p role="alert" data-testid="interjection-error" className="flex items-start gap-1.5 text-12 text-destructive">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {failure}
        </p>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="interject-input" className="sr-only">给正在执行的 agent 插话</Label>
          <Textarea
            id="interject-input"
            data-testid="interjection-input"
            placeholder="例如：第二页标题改成「华北下滑归因分析」"
            value={value}
            rows={2}
            disabled={!canInterject}
            aria-invalid={failure !== null || undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <Button
          variant="primary" data-testid="interjection-send"
          disabled={!value.trim() || pending || !canInterject} onClick={() => void send()}
        >
          <Send aria-hidden className="h-4 w-4" /> 插话
        </Button>
      </div>
      <p className="text-10 text-muted-foreground">⌘/Ctrl + Enter 发送 · 运行中输入框保持可交互（非 disabled）</p>
    </div>
  );
}
