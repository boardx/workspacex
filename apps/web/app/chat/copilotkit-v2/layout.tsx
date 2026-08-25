import { CopilotKitV2Providers } from "./copilotkit-v2-providers";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
// issue #2039 —— 框架消息节点的本仓补样式（见该文件头注：不能写进被
// NormalModuleReplacementPlugin 替换的那份 CSS，替换模块的内容变化在 dev 缓存下
// 不可靠地重新发射；这里走标准 import 管线）。
import "./copilotkit-v2.css";

/**
 * DA-19 —— 独立布局，只作用于 `/chat/copilotkit-v2` 子树（Next App Router 的布局
 * 嵌套规则：兄弟路由 `/chat`、`/chat/copilotkit-preview` 不受影响）。挂
 * `CopilotKitV2Providers`（真正的 `<CopilotKit runtimeUrl>` provider，见该文件头），
 * 不动根 `app/providers.tsx`。
 *
 * ## 为什么这里不显式 `import "@copilotkit/react-core/v2/styles.css"`（provider-setup.md 建议的那行）
 *
 * 不需要写它，也躲不开它：`@copilotkit/react-core/v2` 唯一的公开入口
 * （`dist/v2/index.mjs`，`CopilotKit`/`useAgent`/`useCopilotKit` 全部从这里导出，
 * `package.json` 的 `exports` 表没有能绕开它单独拿到这些 API 的子路径）自己在模块
 * 顶层无条件 `import "./index.css"`——那份 CSS 是 Tailwind v4 编译产物，本仓
 * PostCSS 是 Tailwind v3 一代，装不下它（`@layer base` 缺配对 `@tailwind base` 直接
 * 报语法错，整条引用它的路由编译失败）。真正的修法在 `next.config.mjs` 的
 * `webpack()` 钩子（`NormalModuleReplacementPlugin` 把这一份资源换成本仓自己的空
 * CSS 文件，见那里的完整头注）——本文件不用再写任何 CSS import，那个替换在依赖图
 * 更早的位置就生效了。本任务的面板（`copilotkit-v2-panel.tsx`）也确实不依赖这份
 * 样式（不渲染 `CopilotChat`/`CopilotPopup` 等官方样式化组件），所以换成空文件没有
 * 观感损失；接入那些组件是后续任务的范围。
 *
 * ## issue #2023 —— 新增 `CopilotKitV2AgentSelectionProvider`，包在 `CopilotKitV2Providers` 外层
 *
 * agent 选择状态必须比 `<CopilotKit>` 更高一层：`CopilotKitV2Providers` 内部要读
 * "当前选中的 agent id" 来构造这一轮请求的 header（见
 * `lib/copilotkit-v2-agent-header.ts`），选择本身发生在 `CopilotKitV2Panel`（`children`
 * 子树里）。两者共同的父层只有这里，不是往 `CopilotKitV2Providers` 内部塞状态——那样
 * `CopilotKitV2Panel` 就读不到了。
 */
export default function CopilotKitV2Layout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <CopilotKitV2AgentSelectionProvider>
      <CopilotKitV2Providers>{children}</CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
