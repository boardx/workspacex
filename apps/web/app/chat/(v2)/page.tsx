import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";

/**
 * 正式 Chat 入口，无 URL 参数的"新对话"态。
 *
 * issue #2067 起，本文件不再自己判断 `?projectId=`/`?thread=`——那两支旧屏
 * （`ChatReadScreen`/`PersonalChatScreen`）已经由 `next.config.mjs` 的
 * `rewrites().beforeFiles` 在到达这里之前整体改写到 `/chat/legacy`（同一套组件、
 * 同一份逻辑，见该路由 `page.tsx` 头注），本文件因此只需要处理 v2 这一支，AppShell
 * 与 CopilotKit provider 由共享的 `(v2)/layout.tsx` 提供，不在这里重复组合（那正是
 * #2067 要修的重挂载问题）。
 *
 * 历史沿革（2026-08-25 人类裁决两连）：先「直接更改，chat为新的版本copilot-kit」
 * （#2026，裸 /chat redirect 到灰度路由），再「路由要改为 chat，不要
 * chat/copilotkit-v2，潜入到整体框架」（#2044，CopilotKit v2 体验原生住进 `/chat`
 * 并包进 AppShell 全局壳）。旧灰度地址 `/chat/copilotkit-v2{,/[threadId]}` 仍由
 * `next.config.mjs` 的 `redirects()` 薄跳转过来。
 */
export default function ChatPage(): JSX.Element {
  return <CopilotKitV2Shell initialThreadId={null} />;
}
