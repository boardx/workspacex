import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";

/**
 * ⚠ #2044 起本路由已由 next.config redirects 薄跳转到 `/chat`（新地址），此文件
 * 保留仅为兼容书签/在途 PR，正常流量到不了这棵树；正式承载见
 * `app/chat/copilotkit-v2-experience.tsx`。
 * DA-19 —— CopilotRuntime 适配器灰度候选路由，不挂在 `/chat` 生产入口下
 * （同 `/chat/copilotkit-preview` 的先例，见该路由 `page.tsx` 头注）。
 *
 * issue #2021 —— 裸路由（无 `threadId` 段）= 尚未选中任何持久化线程的"新对话"态。
 * `CopilotKitV2Shell` 首次发消息后会把真实创建出的线程 id 写回地址栏
 * （`window.history.replaceState`，见该组件文件头），不经过这里重新渲染。
 */
export default function CopilotKitV2Page(): JSX.Element {
  return (
    <div className="h-screen w-screen">
      <CopilotKitV2Shell initialThreadId={null} />
    </div>
  );
}
