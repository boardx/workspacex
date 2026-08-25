"use client";

import dynamic from "next/dynamic";

/**
 * #2044 —— v2 体验的**代码分割边界**。
 *
 * ## 为什么需要它（实测反证，不是预防性优化）
 *
 * v2 原生搬进 `/chat` 之后，`app/chat/page.tsx` 的三支（v2 / `?projectId=` 旧项目屏 /
 * `?thread=` 旧个人屏）住在同一个路由模块里。静态 import 的后果是：**旧屏深链也要
 * 下载并执行整份 CopilotKit v2 客户端 bundle**，哪怕那一支根本不渲染它。
 *
 * 实测（本轮三跑，同一 SHA 513704a3 的 main 做基线对照）：`#925 ②`、`#925 ③`、
 * `V4 loading skeleton` 三条**只走 `?projectId=` 旧屏、与 v2 毫无关系**的 e2e，在
 * 基线上通过、在静态 import 版本上全部以 `page.goto(...) waiting until "load"` 超时
 * 收场——失败点在 `load` 事件（下载+执行），不在服务端渲染，这正是"多背了一份客户端
 * bundle"的指纹。灰度路由时代不存在这个耦合（那时 `/chat` 只有旧屏）。
 *
 * `next/dynamic` 把 v2 整棵树放到独立 chunk 后面：只有真正渲染 v2 那一支时浏览器才
 * 去取它，旧屏两支回到改动前的重量。保留 SSR（不传 `ssr: false`）——首屏仍由服务端
 * 渲染，不引入客户端挂载闪烁；分割的是**客户端 chunk 的获取时机**，不是渲染时机。
 *
 * `"use client"` 是 `next/dynamic` 的硬性前提（App Router 下服务端组件里不能用它），
 * 本文件因此只做这一件事：声明边界，不放任何逻辑。真正的组合仍在
 * `./copilotkit-v2-experience.tsx`。
 */
const CopilotKitV2ExperienceLazy = dynamic(
  () => import("./copilotkit-v2-experience").then((mod) => mod.CopilotKitV2Experience),
);

export function CopilotKitV2ExperienceMount({ initialThreadId }: { initialThreadId: string | null }): JSX.Element {
  return <CopilotKitV2ExperienceLazy initialThreadId={initialThreadId} />;
}
