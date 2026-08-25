import { CopilotKitV2ExperienceMount } from "../copilotkit-v2-experience-mount";

/**
 * #2044 —— `/chat/[threadId]`：CopilotKit v2 体验定位到某条持久化线程
 * （`chat_threads.id`，形如 `thr-...`）。逻辑自 `/chat/copilotkit-v2/[threadId]`
 * 平移（该路由现由 next.config redirects 薄跳转到这里）；URL 段承载线程 id 的
 * 理由见旧路由 page.tsx 头注（刷新后续接同一条对话，只有 URL 能跨刷新存活）。
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
  return <CopilotKitV2ExperienceMount initialThreadId={params.threadId} />;
}
