"use client";
import * as React from "react";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopilotKitV2Providers } from "@/app/chat/copilotkit-v2/copilotkit-v2-providers";
import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import type { AgentDirectoryEntry } from "@/lib/ic-review/agent-directory";
import { ensureIcReviewSession, type IcReviewSession } from "@/lib/ic-review/ensure-review-thread";
import { buildStandaloneReviewPrompt } from "@/lib/ic-review/review-prompt";

/**
 * `/agent/team1` 的全部前端 —— 就地挂载真正的 chat 壳，地址栏保持在 team1。
 *
 * ## 为什么不是「中转页 + replace 进 /chat」（上一版这么做，与 team4 同源的错）
 *
 * 本入口与 team4 在 devapp 真机上各栽过一次同一个坑，根因逐字相同：
 *
 * 1. 上一版把 Agent 挂进线程 roster 后就 `replace` 进 `/chat/<threadId>`；
 * 2. `/chat` 那棵树的 `CopilotKitV2AgentSelectionProvider` 初值恒为 `null`
 *    （= 界面上的「能力：自动匹配」），`copilotkit-v2-panel.tsx` 明确写着「刻意不自动选中」；
 * 3. 不选 ⇒ 请求不带 `COPILOTKIT_V2_SELECTED_AGENT_HEADER` ⇒ 服务端
 *    `resolveEffectiveAgentId` 落到「org 动态默认」＝通用助手。
 *
 * 「挂进 roster」决定的是「这条线程编制里有谁」，**不决定「这次请求用哪个 agent」**。
 * 对本 Agent 后果尤其严重：审阅方法论住在线程挂载的「上会审阅」Skill 里，
 * agent 没被选中 ⇒ 那份 Skill 与 instructions 一行都没进 system prompt ⇒
 * 用户拿到的是通用助手的泛泛回答，38 条标准、交叉验证、Excel 结果文件一样都不会有。
 *
 * 本版改成就地挂壳，并把解析出的 `agentId` 作为 `initialAgentId` 交给选择 provider。
 * 壳是 `/chat` 用的同一个（同一套 provider、同一条 AGUI 通道），附件上传、流式、
 * 工具轨迹、产物落地天然都在，本 Agent 不自建第二套 UI；用户之后仍可在 picker 里
 * 换 agent——`initialAgentId` 只设默认，不锁死。
 */

/** 会话解析中 / 解析失败时的那一屏（provider 之外，壳还没挂）。 */
function PreparingScreen({
  agent, failure, onRetry,
}: {
  readonly agent: AgentDirectoryEntry;
  readonly failure: { message: string; needsAdminInit: boolean } | null;
  readonly onRetry: () => void;
}): JSX.Element {
  const [copied, setCopied] = React.useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildStandaloneReviewPrompt([]));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!failure) {
    return (
      <div data-testid="agent-ic-review-entry" className="flex min-w-0 flex-1 items-center justify-center p-6">
        <div className="flex items-center gap-2 text-12 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          正在准备「{agent.name}」的对话…
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-6">
      <Card data-testid="agent-ic-review-entry-error" className="mx-auto max-w-2xl">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
            <p className="text-12 leading-relaxed text-muted-foreground">{failure.message}</p>
          </div>
          {failure.needsAdminInit ? (
            <Button variant="outline" size="sm" onClick={() => void copyPrompt()} data-testid="agent-copy-prompt">
              {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? "已复制" : "复制审阅任务书（可粘到任意对话）"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 页面级挂点。
 *
 * ⚠ 会话**只解析一次**，且解析完成后才挂 provider 与壳。两条都是必须的：
 * ① `CopilotKitV2AgentSelectionProvider` 的 `initialAgentId` 走 `useState` 初值，
 *    只在首次挂载时读——先挂 provider 再异步 setState，provider 里仍然是 `null`，
 *    请求照样不带 header，等于没修；
 * ② 解析会**建线程**。让 provider 外和壳内各调一次，就是两条空线程。
 */
export function IcReviewChatEntry({ agent }: { readonly agent: AgentDirectoryEntry }): JSX.Element {
  const [session, setSession] = React.useState<IcReviewSession | null>(null);
  const [failure, setFailure] = React.useState<{ message: string; needsAdminInit: boolean } | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // ⚠ 用 `window.location` 而不是 `useSearchParams()`：本页有 `generateStaticParams`，
        // 静态导出时 `useSearchParams` 必须包 Suspense 才能编译过；这里只在客户端 effect
        // 里读一次，不值得为它加一层边界。
        const forceNew = new URLSearchParams(window.location.search).get("new") === "1";
        const resolved = await ensureIcReviewSession(forceNew);
        if (!cancelled) setSession(resolved);
      } catch (error) {
        if (cancelled) return;
        const needsAdminInit = error instanceof ApiError && error.reasonCode === "ROLE_INSUFFICIENT";
        setFailure({
          needsAdminInit,
          message: needsAdminInit
            ? "这个 Agent 在当前组织里还没有人发布过，需要一位组织管理员先打开本页完成一次初始化——之后所有人都能直接用。"
            : "无法准备这个 Agent 的对话（建线程或挂载技能失败），请稍后重试。",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  if (session === null) {
    return (
      <AppShell previewRole={null}>
        <PreparingScreen agent={agent} failure={failure} onRetry={() => { setFailure(null); setAttempt((n) => n + 1); }} />
      </AppShell>
    );
  }

  return (
    <CopilotKitV2AgentSelectionProvider initialAgentId={session.agentId}>
      <CopilotKitV2Providers>
        <AppShell previewRole={null} hideTopBar>
          <div data-testid="agent-ic-review-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* 个人线程 ⇒ projectId 恒为 null（壳的入参本就是 `string | null`）。 */}
            <CopilotKitV2Shell initialThreadId={session.threadId} projectId={null} />
          </div>
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
