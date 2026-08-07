"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";

/**
 * #654 阶段 1a —— CopilotKit provider 骨架，未接入任何生产路径。
 *
 * ## 这是什么,不是什么
 *
 * 这**不是**生产 chat 的替换品。它是人类直接指令（#654）要求的 CopilotKit UI 落地
 * 起点：证明依赖装得上、provider 能渲染、聊天输入框不需要任何 agent id 字段。
 * `runtimeUrl` 指向的 `/api/copilotkit` **目前不存在** —— 阶段 1b 才会在
 * `apps/api` 侧新增一个 AG-UI 桥接端点（需要走 API 契约签核，见 issue #654
 * 的决策项 3）。在那之前，这个面板发消息会失败，这是预期状态，不是 bug。
 *
 * ## 为什么不挂在 `/chat` 现有入口下
 *
 * `apps/web/app/chat/page.tsx` 是签核过的生产路径（`PersonalChatScreen` /
 * `ChatReadScreen`），本骨架不动它一个字。新页面挂在独立路由
 * `/chat/copilotkit-preview`，两条路径互不干扰，方便逐步替换而不是一次性切换。
 */
export function CopilotKitPreviewPanel(): JSX.Element {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <div className="flex h-full w-full flex-col">
        <CopilotChat
          labels={{
            title: "CopilotKit 预览（阶段 1a，后端未接入）",
            initial: "随便输入点什么——不需要填任何 agent id。",
          }}
        />
      </div>
    </CopilotKit>
  );
}
