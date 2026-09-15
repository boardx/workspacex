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
import { POST_INVESTMENT_AGENT } from "@/lib/post-investment/agent-directory";
import { ensurePostInvestmentSession, type PostInvestmentSession } from "@/lib/post-investment/ensure-thread";
import { buildStandaloneAnalysisPrompt } from "@/lib/post-investment/methodology";

/**
 * `/agent/team4` 的全部前端 —— 就地挂载真正的 chat 壳，地址栏保持在 team4。
 *
 * ## 为什么不是"中转页 + replace 进 /chat"（上一版这么做，实测是错的）
 *
 * 2026-09-15 真机截图：在这条对话里问"你可以做什么"，回答的是**通用助手**的能力
 * 清单（文档处理/信息检索/数据分析/…），没有投后方法论的影子。根因不是模型表现差，
 * 是**本 Agent 根本没参与这次对话**：
 *
 * 1. 上一版把 Agent 挂进线程 roster 后就 `replace` 进 `/chat/<threadId>`；
 * 2. `/chat` 那棵树的 `CopilotKitV2AgentSelectionProvider` 初值恒为 `null`
 *    （= 界面上的「能力：自动匹配」），且 `copilotkit-v2-panel.tsx` 明确写着
 *    "刻意不自动选中"——"不选"是它必须保持可用的状态；
 * 3. 不选 ⇒ 请求不带 `COPILOTKIT_V2_SELECTED_AGENT_HEADER` ⇒ 服务端
 *    `resolveEffectiveAgentId` 落到第 ③ 级「org 动态默认」= 通用助手。
 *
 * 「挂进 roster」决定的是"这条线程编制里有谁"，**不决定"这次请求用哪个 agent"**。
 * 本版改成就地挂壳，并把解析出的 `agentId` 作为 `initialAgentId` 交给选择 provider
 * ——请求这才带上 header，服务端走"用户手选"分支用本 Agent。
 *
 * 壳是 `/chat` 用的同一个（同一套 provider、同一条 AGUI 通道），附件上传、流式、
 * 工具轨迹、产物落地等能力天然都在，本 Agent 不自建第二套 UI。用户之后仍可在
 * picker 里换 agent——`initialAgentId` 只设默认，不锁死。
 */

/** 会话解析中 / 解析失败时的那一屏（provider 之外，壳还没挂）。 */
function PreparingScreen({
  failure, onRetry,
}: {
  failure: { message: string; needsAdminInit: boolean } | null;
  onRetry: () => void;
}): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildStandaloneAnalysisPrompt([]));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (failure !== null) {
    return (
      <Card data-testid="agent-post-investment-entry-error" className="m-6">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 text-warning-foreground" />
            <p className="text-12 leading-relaxed text-muted-foreground">{failure.message}</p>
          </div>
          {failure.needsAdminInit ? (
            <Button variant="outline" size="sm" onClick={() => void copyPrompt()} data-testid="agent-copy-prompt">
              {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              {copied ? "已复制" : "复制投后报告方法论（可粘到任意对话）"}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div data-testid="agent-post-investment-entry" className="space-y-2 p-6">
      <div className="flex items-center gap-2 text-12 text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        正在准备「{POST_INVESTMENT_AGENT.name}」的对话…
      </div>
      {/* 转场期间也把"这是谁、能干什么"说清楚，不是一个空白转圈。 */}
      <p className="text-11 leading-relaxed text-muted-foreground">{POST_INVESTMENT_AGENT.tagline}</p>
      <ul className="space-y-0.5">
        {POST_INVESTMENT_AGENT.capabilities.map((c) => (
          <li key={c.evidence} className="text-11 leading-relaxed text-muted-foreground">· {c.text}</li>
        ))}
      </ul>
      <ul className="space-y-0.5">
        {POST_INVESTMENT_AGENT.boundaries.map((b) => (
          <li key={b} className="text-11 leading-relaxed text-muted-foreground">✕ {b}</li>
        ))}
      </ul>
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
export function PostInvestmentChatScreen(): JSX.Element {
  const [session, setSession] = React.useState<PostInvestmentSession | null>(null);
  const [failure, setFailure] = React.useState<{ message: string; needsAdminInit: boolean } | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // ⚠ 用 `window.location` 而不是 `useSearchParams()`：本页有
        // `generateStaticParams`，静态导出时 `useSearchParams` 必须包 Suspense 才
        // 能编译过；这里只在客户端 effect 里读一次，不值得为它加一层边界。
        const forceNew = new URLSearchParams(window.location.search).get("new") === "1";
        const resolved = await ensurePostInvestmentSession(forceNew);
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
        <PreparingScreen failure={failure} onRetry={() => { setFailure(null); setAttempt((n) => n + 1); }} />
      </AppShell>
    );
  }

  return (
    <CopilotKitV2AgentSelectionProvider initialAgentId={session.agentId}>
      <CopilotKitV2Providers>
        <AppShell previewRole={null} hideTopBar>
          <div data-testid="agent-post-investment-chat" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* 个人线程 ⇒ projectId 恒为 null（壳的入参本就是 `string | null`）。 */}
            <CopilotKitV2Shell initialThreadId={session.threadId} projectId={null} />
          </div>
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
