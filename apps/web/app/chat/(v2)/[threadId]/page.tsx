/**
 * #2044 —— `/chat/[threadId]`：CopilotKit v2 体验定位到某条持久化线程
 * （`chat_threads.id`，形如 `thr-...`）。URL 段承载线程 id 的理由见旧路由
 * `/chat/copilotkit-v2/[threadId]` page.tsx 头注（刷新后续接同一条对话，只有 URL
 * 能跨刷新存活）；该旧路由现由 next.config redirects 薄跳转到这里。
 *
 * 2026-09-02 起本文件不再渲染任何东西，也不再把 `params.threadId` 传给壳：
 * `[threadId]` 是动态段，Next App Router 对每个段值维护独立子树，page 级挂载的
 * `CopilotKitV2Shell` 会在每次线程切换时被整个卸载重建——壳内部为"快速切换不跳"
 * 做的全部记忆随实例丢失、旧实例的兜底计时器还会在卸载后再推一次旧路由，这就是
 * 前四轮修复（#2480/#2494/#2501/#2506）全部落空的原因。壳现在由 `(v2)/layout.tsx`
 * 挂载、用 `useParams()` 读线程 id（见 `components/chat/copilotkit-v2-shell-route.tsx`
 * 头注）。这条路由仍然必须存在，否则 Next 不认 `/chat/thr-…`。
 *
 * ⚠ Next 静态段优先于动态段：兄弟静态路由 `/chat/legacy|live|landing|preset|
 * copilotkit-preview|copilotkit-v2` 不会被本段吞掉；反向约束是线程 id 不得与这些
 * 字面量撞名（真实 id 形如 `thr-...`，天然安全）。
 */
export default function ChatThreadPage(): null {
  return null;
}
