"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentDirectoryEntry } from "@/lib/ic-review/agent-directory";
import { ensureIcReviewThreadId } from "@/lib/ic-review/ensure-review-thread";
import { buildStandaloneReviewPrompt } from "@/lib/ic-review/review-prompt";

/**
 * `/agent/team1` 的全部前端 —— 一个**中转页**，不是一个工作台。
 *
 * 它准备好线程（Agent 入编 + Skill 挂载，见 `lib/ic-review/ensure-review-thread.ts`）
 * 就 `replace` 进真正的 chat（`/chat/<threadId>`）。上传材料、追问、两轮确认全部用
 * chat 自己的能力完成——本 Agent 不再有第二套上传框、第二套结果面板。
 *
 * 失败不静默：非管理员第一次进来会撞上服务端的 `ROLE_INSUFFICIENT`（建 Agent 只放行
 * org admin），这时降级成「复制审阅任务书」——用户把它粘进任意一条普通对话、附上材料，
 * 照样能用，只是没有挂载的 Skill 与固定编制。
 */
export function IcReviewChatEntry({ agent }: { agent: AgentDirectoryEntry }) {
  const router = useRouter();
  const [failure, setFailure] = React.useState<{ message: string; needsAdminInit: boolean } | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // ⚠ 用 `window.location` 而不是 `useSearchParams()`：本页有
        // `generateStaticParams`，静态导出时 `useSearchParams` 必须包 Suspense 才
        // 能编译过；这里只在客户端 effect 里读一次，不值得为它加一层边界。
        const forceNew = new URLSearchParams(window.location.search).get("new") === "1";
        const threadId = await ensureIcReviewThreadId(forceNew);
        if (!cancelled) router.replace(`/chat/${encodeURIComponent(threadId)}`);
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
  }, [attempt, router]);

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
      <div data-testid="agent-ic-review-entry" className="flex items-center gap-2 text-12 text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        正在准备「{agent.name}」的对话…
      </div>
    );
  }

  return (
    <Card data-testid="agent-ic-review-entry-error">
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
          <Button variant="outline" size="sm" onClick={() => { setFailure(null); setAttempt((n) => n + 1); }}>
            重试
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
