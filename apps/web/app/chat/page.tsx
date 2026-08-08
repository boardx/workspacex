import { ChatReadScreen } from "@/components/chat/chat-read-screen";
import { PersonalChatScreen } from "@/components/chat/personal-chat-screen";

/**
 * 正式 Chat 只读路径。
 *
 * projectId 来自真实路由查询。🔴 #594（人类本人直接推翻此前裁决，方案 A）：
 * 缺失时**不再**显示"请先选择项目"的拦截空态——走 `PersonalChatScreen`（个人对话，
 * 不挂靠任何项目）。两条路径共用同一个 `/chat` 入口，`projectId` 是分岔点：
 * 有 ⇒ 项目内对话（`ChatReadScreen`，逐字节未改）；无 ⇒ 个人对话（新组件）。
 */
export default function ChatPage({
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
