"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { TaskNotifications } from "@/components/chat/workbench/task-notifications";
import { useOptionalSession } from "@/components/session/session-provider";
import { workbenchThreadPath } from "@/lib/chat-workbench/project-scope";

/**
 * issue #3246（人类 2026-09-10 devapp 验收原话：「这个 notification icon 放在左边的
 * navbar 吧」）—— 通知铃铛从**会话列表栏顶部**搬到**最左侧图标导航栏**。
 *
 * ⚠ 这是搬位置，不是重做：弹层本体仍是 #3226 那一个 `TaskNotifications`
 * （未读计数 / 全部标为已读 / 最近已读 / 全套 a11y），这里只提供 rail 形态需要的两样
 * 外壳依赖，并传 `variant="rail"`。不要在这里另写一份通知 UI。
 *
 * ## 为什么自己取 session 而不是从 `AppShell` 一路透传
 * `IconRail` 有两条挂载路径（`identity` 直传 / `SessionProvider`），透传要改三处签名。
 * 与 `FeedbackButton` 同一条纪律：拿不到上下文就渲染 `null`，不占位、不报错。
 *
 * ## 点开通知跳对话
 * 老位置在聊天外壳里，用的是外壳的软导航 `selectThread`；图标栏是全局的（可能停在
 * 任何一个页面），只能用路由跳转——目标 URL 由 `workbenchThreadPath` 这一个事实源给出。
 */
export function RailNotifications(): React.JSX.Element | null {
  const session = useOptionalSession();
  const router = useRouter();
  const bearer = session?.session?.sessionToken ?? null;
  const openThread = React.useCallback(
    (threadId: string) => router.push(workbenchThreadPath(threadId, null)),
    [router],
  );
  if (bearer === null) return null;
  return <TaskNotifications variant="rail" sessionToken={bearer} onOpenThread={openThread} />;
}
