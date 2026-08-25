import { ChatReadScreen } from "@/components/chat/chat-read-screen";
import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

/**
 * 旧手写 Chat 轨道的显式回退入口（S1=B 灰度纪律）。
 *
 * 2026-08-25 人类裁决把 `/chat` 默认入口翻转到 CopilotKit v2 后，旧屏从默认位
 * 退到这里：裸 `/chat/legacy` 与带参数的 `/chat?projectId=`/`?thread=`（后者由
 * `/chat/page.tsx` 分岔，理由见那边头注）都渲染同一套旧屏。本路由存在到 DA-19h
 * （旧轨道退役，需人类再次确认）为止——不要因为它「旧」就顺手删，回退路径消失
 * 等于灰度变成单向门。
 *
 * projectId 分岔逻辑原文（#594，人类本人直接推翻此前裁决，方案 A）：缺失时不再
 * 显示「请先选择项目」的拦截空态——走 `PersonalChatScreen`（个人对话，不挂靠
 * 任何项目）。有 ⇒ 项目内对话（`ChatReadScreen`）。
 */
export default function ChatLegacyPage({
  searchParams,
}: {
  searchParams: { projectId?: string; thread?: string };
}) {
  const projectId = nonEmpty(searchParams.projectId);
  const threadId = nonEmpty(searchParams.thread);
  if (projectId === null) return <PersonalChatScreen initialThreadId={threadId} />;
  return <ChatReadScreen projectId={projectId} initialThreadId={threadId} />;
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
