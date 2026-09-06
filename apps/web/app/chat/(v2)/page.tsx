/**
 * 正式 Chat 入口，无 URL 参数的"新对话"态。
 *
 * 2026-09-02 起本文件不再渲染任何东西：`CopilotKitV2Shell` 由共享的 `(v2)/layout.tsx`
 * 挂载（经 `components/chat/copilotkit-v2-shell-route.tsx` 用 `useParams()` 取线程
 * id），这样 `/chat` ↔ `/chat/[threadId]` 之间切换时壳保持同一个实例——page 级
 * 挂载会随动态段取值每次卸载重建，正是"快速切换线程后选中态跳回旧线程"的根因
 * （该文件头注有完整推导）。这条路由仍然必须存在，否则 Next 不认裸 `/chat`。
 *
 * Project and personal query links share this route. ShellRoute resolves scope,
 * while the shared layout owns the one AppShell and CopilotKit provider tree.
 *
 * 历史沿革（2026-08-25 人类裁决两连）：先「直接更改，chat为新的版本copilot-kit」
 * （#2026，裸 /chat redirect 到灰度路由），再「路由要改为 chat，不要
 * chat/copilotkit-v2，潜入到整体框架」（#2044，CopilotKit v2 体验原生住进 `/chat`
 * 并包进 AppShell 全局壳）。旧灰度地址 `/chat/copilotkit-v2{,/[threadId]}` 仍由
 * `next.config.mjs` 的 `redirects()` 薄跳转过来。
 */
export default function ChatPage(): null {
  return null;
}
