import { CopilotKitV2Panel } from "@/components/chat/copilotkit-v2-panel";

/**
 * DA-19 —— CopilotRuntime 适配器灰度候选路由，不挂在 `/chat` 生产入口下
 * （同 `/chat/copilotkit-preview` 的先例，见该路由 `page.tsx` 头注）。
 */
export default function CopilotKitV2Page(): JSX.Element {
  return (
    <div className="h-screen w-screen">
      <CopilotKitV2Panel />
    </div>
  );
}
