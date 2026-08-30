import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";

/**
 * #2044 —— `/chat/[threadId]`：CopilotKit v2 体验定位到某条持久化线程
 * （`chat_threads.id`，形如 `thr-...`）。逻辑自 `/chat/copilotkit-v2/[threadId]`
 * 平移（该路由现由 next.config redirects 薄跳转到这里）；URL 段承载线程 id 的
 * 理由见旧路由 page.tsx 头注（刷新后续接同一条对话，只有 URL 能跨刷新存活）。
 *
 * issue #2067 起，与裸 `/chat` 一起收进 `(v2)` 路由组：AppShell 与 CopilotKit
 * provider 由共享的 `(v2)/layout.tsx` 提供，两个 page 之间切换只重渲染这里返回的
 * `CopilotKitV2Shell`，不再重挂载 AppShell（见该 layout 文件头的完整根因说明）。
 *
 * ⚠ Next 静态段优先于动态段：兄弟静态路由 `/chat/legacy|live|landing|preset|
 * copilotkit-preview|copilotkit-v2` 不会被本段吞掉；反向约束是线程 id 不得与这些
 * 字面量撞名（真实 id 形如 `thr-...`，天然安全）。
 */
export default function ChatThreadPage({
  params,
}: {
  params: { threadId: string };
}): JSX.Element {
  return <CopilotKitV2Shell initialThreadId={params.threadId} />;
}
