"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "@/components/session/session-provider";
import { GlobalErrorReporter } from "@/components/system/global-error-reporter";

/**
 * ADR-109 —— 客户端数据获取层的根 Provider。
 *
 * `staleTime` 默认给一个非 0 的短值（而不是库默认的 0）：库默认值等于"每次组件挂载都
 * 判定数据已过期、立刻重新请求"，那和现状（`useEffect` 每次挂载都 fetch 一次）在行为上
 * 没有区别，拿不到"页面切换/返回时不用等"的收益——ADR-109 要解决的正是这一点。
 * 30s 是保守起点：够短，不会让"数据明显过期但界面不刷新"这类问题在迁移初期难以察觉；
 * 各域如果需要更长的 staleTime（数据变化慢）或更短（近实时），在各自 `useQuery` 里覆盖，
 * 不必现在就给全仓库定死一个"正确"的值。
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 每个域自己的 useLive*/use* hook 决定要不要重试、重试几次；默认关闭，
        // 避免"取不到 ⇒ 显示 —"这类 fail-closed 语义被库的默认重试悄悄延迟触发。
        retry: false,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <GlobalErrorReporter />
        {children}
      </SessionProvider>
    </QueryClientProvider>
  );
}
