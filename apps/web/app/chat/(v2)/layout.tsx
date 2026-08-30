import { AppShell } from "@/components/shell/app-shell";
import { CopilotKitV2AgentSelectionProvider } from "@/lib/copilotkit-v2-agent-selection";
import { CopilotKitV2Providers } from "../copilotkit-v2/copilotkit-v2-providers";

/**
 * issue #2067 —— 修 "切换 thread 时 AppShell 整体重挂载" 的根因所在。
 *
 * ## 根因回顾（详见 issue 本身）
 *
 * 此前 `AppShell`/`CopilotKitV2Providers`/`CopilotKitV2AgentSelectionProvider` 是在
 * `copilotkit-v2-experience.tsx` 里、每次渲染都重新组合的一棵树，而 `/chat` 与
 * `/chat/[threadId]` 是两个独立的 page 模块、中间没有共享的 `layout.tsx`——切换线程
 * 时 `router.push(/chat/${threadId})`，Next App Router 找不到共享布局边界，把整棵树
 * （含 AppShell 与两个 provider）整体卸载重装，视觉上与真刷新几乎没区别。
 *
 * ## 修法：路由组 `(v2)`，不出现在 URL 里
 *
 * 把 `/chat`（v2 分支）与 `/chat/[threadId]` 都收进这个路由组，AppShell/provider
 * 只在这一层挂载一次；组内两个 page 切换时只有 `children`（`CopilotKitV2Shell`）
 * 重渲染。路由组是 Next App Router 的既有机制，不产生 URL 段——`/chat/legacy`、
 * `/chat/live` 等**不在这个组里**的兄弟路由完全不受影响。
 *
 * ## 为什么带 `?projectId=`/`?thread=` 的深链不会被套进这层 AppShell 两次
 *
 * 那两个分支渲染的 `ChatReadScreen`/`PersonalChatScreen` 各自已经自带一个
 * `<AppShell>`——如果它们也被收进这个路由组，就会被套两层 AppShell。真正的解法是
 * 在 `next.config.mjs` 的 `rewrites().beforeFiles` 里，在请求到达这层路由**之前**
 * 就把带这两个 query key 的 `/chat` 请求整个改写到 `/chat/legacy`（该文件头注有完整
 * 说明）——这样 `(v2)/page.tsx` 自己不再需要判断 query string，也就不存在双重
 * AppShell 的问题；本 layout 因此可以放心对组内两个 page 无条件包一层 AppShell。
 */
export default function ChatV2Layout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <CopilotKitV2AgentSelectionProvider>
      <CopilotKitV2Providers>
        <AppShell previewRole={null} hideTopBar>
          {children}
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
