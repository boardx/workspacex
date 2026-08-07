import { CopilotKitPreviewPanel } from "@/components/chat/copilotkit-preview-panel";

/**
 * #654 阶段 1a —— 独立预览路由，不挂在 `/chat` 生产入口下（见组件头注）。
 */
export default function CopilotKitPreviewPage(): JSX.Element {
  return (
    <div className="h-screen w-screen">
      <CopilotKitPreviewPanel />
    </div>
  );
}
