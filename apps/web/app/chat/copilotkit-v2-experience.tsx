import { AppShell } from "@/components/shell/app-shell";
import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Providers } from "./copilotkit-v2/copilotkit-v2-providers";

/**
 * #2044 —— 人类指令（原话）：「路由要改为 chat，不要 chat/copilotkit-v2，潜入到整体框架」。
 *
 * CopilotKit v2 体验从灰度路由 `/chat/copilotkit-v2` 原生搬进 `/chat`，并且**包在
 * AppShell 里**（与旧屏 `personal-chat-screen.tsx` 同一个全局壳：图标栏 + 顶栏 +
 * 移动端底部 tab）——chat 回到产品整体框架内，不再是独立全屏裸页。
 *
 * ## 为什么是独立组件而不是 `app/chat/layout.tsx`
 *
 * `/chat` 的 page.tsx 是三岔口（v2 / `?projectId=` 旧项目屏 / `?thread=` 旧个人屏，
 * 见该文件头注）——v2 的 provider 树（AgentSelection + `<CopilotKit runtimeUrl>`）
 * 只该挂在 v2 分支上。放 `app/chat/layout.tsx` 会把 provider 罩到 `/chat/legacy`、
 * `/chat/live` 等全部兄弟路由头上；放这里则由 page 按分支显式选用。
 * `/chat/[threadId]/page.tsx` 与裸 `/chat` 的 v2 分支共用本组件，provider 组合只
 * 声明一次（provider 本体仍住在 `./copilotkit-v2/copilotkit-v2-providers.tsx`，
 * 旧灰度路由的 layout 也还引它——HTTP 层 redirect 生效后那棵树不再被渲染，见
 * `next.config.mjs` redirects 注释）。
 *
 * ## AppShell 的接法：v2 线程列表留在内容区，不占 `left` 槽
 *
 * `CopilotKitV2Shell` 自带「线程列表 + 面板」双栏（w-64 aside，见该文件），整体作为
 * AppShell 的 children 放进 `shell-main`——线程列表因此是框架内的**二级栏**（一级
 * 导航是 AppShell 的 IconRail）。不拆 shell 把列表塞进 `left` prop：那需要把 shell
 * 的状态/回调劈成两个槽位，而 UIUX 迭代线正并行改 shell/panel 的样式层（并行冲突
 * 预警，2026-08-25），这里刻意只做包裹不做重排。
 *
 * ## 入口是 `./copilotkit-v2-experience-mount.tsx`，不是本文件
 *
 * 页面（`app/chat/page.tsx` / `app/chat/[threadId]/page.tsx`）引的是那个 `"use client"`
 * 的薄壳，它用 `next/dynamic` 把本文件整棵树放到独立 chunk 后面——否则 `?projectId=`
 * 旧屏深链也要下载执行整份 v2 客户端 bundle（三条旧屏 e2e 因此在 `load` 事件超时，
 * 基线对照实测记录见那个文件的头注）。本文件本身只负责"组合"，不关心加载时机。
 *
 * AppShell 未登录时自行 redirect `/login`（`SessionAppShell`），与旧屏行为一致——
 * 灰度路由时代未登录会渲染出无会话的空面板，这是收益不是回归。
 */
export function CopilotKitV2Experience({ initialThreadId }: { initialThreadId: string | null }): JSX.Element {
  return (
    <CopilotKitV2AgentSelectionProvider>
      <CopilotKitV2Providers>
        <AppShell previewRole={null}>
          <CopilotKitV2Shell initialThreadId={initialThreadId} />
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
