import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";

/**
 * issue #2021 —— 消息持久化 + 多线程管理：`threadId` 是后端真实持久化的
 * `chat_threads.id`（同一张表 `PersonalChatScreen`/`ChatReadScreen` 也在读写，见
 * `copilotkit-v2-shell.tsx` 文件头"为什么复用同一张表"一节）。这个路由段存在，
 * 刷新页面时浏览器带着它重新请求，`CopilotKitV2Shell`/`CopilotKitV2Panel` 才能
 * 在挂载时用它回读历史消息、续接同一条对话——没有这个 URL 段，"刷新后消息还在"
 * 这件事在 App Router 下无处落地（组件树内部状态刷新即丢，只有 URL 能跨刷新存活）。
 */
export default function CopilotKitV2ThreadPage({
  params,
}: {
  params: { threadId: string };
}): JSX.Element {
  return (
    <div className="h-screen w-screen">
      <CopilotKitV2Shell initialThreadId={params.threadId} />
    </div>
  );
}
