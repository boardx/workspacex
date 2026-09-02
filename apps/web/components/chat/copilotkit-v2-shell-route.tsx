"use client";

import { useParams } from "next/navigation";
import { CopilotKitV2Shell } from "./copilotkit-v2-shell";

/**
 * 2026-09-02 人类实测反馈第五轮——round 4（PR #2506）把 `selectedThreadId` 改成
 * "只在首次挂载时读 `initialThreadId`"，本地真浏览器复现（A→B→C 快速连点）仍然
 * 跳：最后点的是 B，随后 30 秒里高亮与地址栏在 A/B/C 之间来回换了六次。
 *
 * ## 真正的根因：`CopilotKitV2Shell` 根本活不过一次线程切换
 *
 * 此前这层壳是由 `app/chat/(v2)/page.tsx` 与 `app/chat/(v2)/[threadId]/page.tsx`
 * 各自渲染的。`[threadId]` 是动态段——Next App Router 对动态段的每一个取值维护
 * **各自独立**的一棵子树（cache node 以段值为 key），`/chat/A` → `/chat/B` 不是
 * "同一个 page 用新 params 重渲染"，而是卸载 A 那棵、挂载 B 那棵。本地实测：
 * 侧栏 `<aside>` 的 DOM 节点在每次切换后都是新节点（在旧节点上打的标记消失）。
 *
 * 于是 round 4 "只在首次挂载读 `initialThreadId`" 这句话的前提不成立——每一次
 * 软导航结算都是一次"首次挂载"，`useState(initialThreadId)` 就是在用那次（可能已
 * 过期的）结算结果重新初始化显示状态。前四轮所有修法都写在这层壳的内部，而这层壳
 * 本身每次都被扔掉重来，内部记什么都记不住：`latestIntentRef`、防抖计时器、
 * `navigationGeneration` 全部随实例一起丢失。更糟的是旧实例 `pushThreadRoute` 的
 * 4 秒兜底 `setTimeout` **并不随卸载取消**，它闭包里的 `navigationGeneration`、
 * `confirmedThreadIdRef` 是旧实例自己的、永远不会再更新，到点必然判"没成功"再
 * `router.push` 一次旧目标——这就是"停下来之后还会跳回去"的直接来源。
 *
 * ## 修法：把壳提到 `(v2)/layout.tsx` 这一层挂载
 *
 * layout 在其子段切换时**保持实例**（这正是 #2067 把 AppShell 提进 layout 的同一个
 * 机制），壳因此真的只挂载一次，round 4 的"首次挂载"前提才成立。线程 id 不再由
 * page 的 `params` 传入，而是在这里用 `useParams()` 读——它在 layout 级客户端组件
 * 里同样能看到子段 `[threadId]` 的取值，软导航结算后只是 prop 变化、不是重挂载。
 * `CopilotKitV2Shell` 自己已经保证 `initialThreadId` 的后续变化不会碰显示状态
 * （只喂 `confirmedThreadIdRef` 这一份"路由真的结算了"的信号）。
 *
 * 两个 page.tsx 因此退化为空页——路由必须存在（否则 Next 不认这条 URL），但
 * 内容由 layout 提供。
 */
export function CopilotKitV2ShellRoute(): JSX.Element {
  const params = useParams<{ threadId?: string }>();
  const raw = params?.threadId;
  const threadId = typeof raw === "string" && raw.length > 0 ? decodeURIComponent(raw) : null;
  return <CopilotKitV2Shell initialThreadId={threadId} />;
}
