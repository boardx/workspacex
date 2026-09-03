import { CopilotKitV2ShellRoute } from "@/components/chat/copilotkit-v2-shell-route";
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
 * 只在这一层挂载一次。路由组是 Next App Router 的既有机制，不产生 URL 段——
 * `/chat/legacy`、`/chat/live` 等**不在这个组里**的兄弟路由完全不受影响。
 *
 * ## 2026-09-02 第五轮：`CopilotKitV2Shell` 也提到这一层
 *
 * #2067 时的说法是"组内两个 page 切换时只有 `children`（壳）重渲染"——这句话
 * 是错的：`[threadId]` 是动态段，段值变了就是**卸载旧子树、挂载新子树**，壳每次
 * 都被整个重建，它内部为"快速切换不跳"做的全部记忆随实例一起丢掉（完整推导见
 * `components/chat/copilotkit-v2-shell-route.tsx` 头注）。壳现在由本 layout 挂载，
 * 与 AppShell 一样跨线程切换保持实例；`children`（两个 page.tsx）只剩下"让这条
 * URL 存在"的作用，渲染为空。
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
          <CopilotKitV2ShellRoute />
          {children}
        </AppShell>
      </CopilotKitV2Providers>
    </CopilotKitV2AgentSelectionProvider>
  );
}
