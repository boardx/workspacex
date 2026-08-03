import { ChatReadScreen } from "@/components/chat/chat-read-screen";

/**
 * 正式 Chat 只读路径。
 *
 * projectId 必须来自真实路由查询；缺失时由 ChatReadScreen 显示诚实空态。
 * 线程列表、详情、消息与 roster 全部使用 SessionProvider 的 bearer/currentOrg，
 * 本页面不提供发送、新建线程、roster 修改或任何 mock fallback。
 */
export default function ChatPage({
  searchParams,
}: {
  searchParams: { projectId?: string; thread?: string };
}) {
  const projectId = nonEmpty(searchParams.projectId);
  const threadId = nonEmpty(searchParams.thread);
  return <ChatReadScreen projectId={projectId} initialThreadId={threadId} />;
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
