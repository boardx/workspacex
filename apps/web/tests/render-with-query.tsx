/**
 * render-with-query.tsx — ADR-109 迁移引入。
 *
 * 任何组件树里只要有一个 `useQuery`/`useMutation`，就必须在 `QueryClientProvider` 之下
 * 渲染，否则 TanStack Query 直接抛错（"No QueryClient set"）——这不是本仓特有的规则，
 * 是这个库本身的要求。真实 app 在 `app/providers.tsx` 已经包好了；单元测试里组件是被
 * 裸渲染的（不经过 `app/providers.tsx`），所以需要这个等价的最小 wrapper。
 *
 * 用法：`render(<AdminNav />, { wrapper: QueryClientTestWrapper })`
 * ——只包一层 Provider，不改任何断言、不影响原有测试的判定逻辑。
 *
 * 每次调用创建一个全新的 `QueryClient`（不跨测试复用单例）：复用会让上一个测试 stub 的
 * `fetch`/mock 数据通过缓存"泄漏"进下一个测试，制造这类测试之间互相污染、只能靠执行
 * 顺序侥幸绿过的 flaky 源——本仓对此类"共享可变状态跨用例污染"的形态有过明确教训
 * （见 `.harness/instructions/static-trace-vs-live-fact.md` 同类精神）。
 */
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryClientTestWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 0 },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
