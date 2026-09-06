/**
 * #2044 —— `/chat` 路由的一次性首编译预热。
 *
 * ## 为什么这件事从本次改动起是必须的
 *
 * v2 体验原生搬进 `/chat` 之后，`app/chat/page.tsx` 的模块图里同时挂着
 * CopilotKit v2 provider 树（`@copilotkit/react-core/v2` + runtime 适配器）与
 * 旧屏两支（`ChatReadScreen`/`PersonalChatScreen`）——Next dev 按**路由**编译，
 * 不按渲染到的分支编译，所以任何一次 `/chat*` 请求都要付这份完整编译成本。
 *
 * 实测（本轮 run1，18 failed / 17 passed）：5 个 worker 各自撞上这次首编译，
 * `page.goto("/chat")` 与 `page.goto("/chat?projectId=…")` 双双以
 * `Test timeout of 120000ms exceeded` / `net::ERR_ABORTED` 收场——**连不碰 v2 的
 * 旧屏深链 spec 也被拖垮**，因为它们和 v2 共用同一个 page 模块。这不是链路 bug，
 * 是编译成本被乘以 worker 数。
 *
 * ## 为什么放 globalSetup，而不是给每个 spec 再加一份超时
 *
 * 各 copilotkit spec 里已有的 `warmUpCopilotRuntimeRoute` 是**每个 worker 自己**
 * 付一次编译；worker 之间不共享这份等待，且旧屏 spec 根本没有这个 helper。
 * globalSetup 在全部 webServer ready 之后、任何 worker 起来之前跑一次，编译结果
 * 是 Next dev 进程级的，所有 worker 随后走的都是热路径——同一个事实只预热一次，
 * 不在 22 个 spec 里复制 22 份等待。既有的 per-spec 预热保留不动：热路径下它们
 * 一轮 poll 即返回，无成本，且单独跑某个 spec（不经本 config）时仍然有效。
 *
 * 预算 300s 取自 spec 里已有的实测上界注记（`copilotkit-v2-agent-switch.spec.ts`
 * 头部："`/chat` 首编译实测要 2-3 分钟"），不是拍脑袋。超时即抛：预热失败必须让
 * 整轮红在这里，而不是退化成 22 个 spec 各自超时的噪声。
 */
const WEB_PORT = process.env.WORKSPACEX_WEB_PORT;

/** 逐条编译预热的路由。每条都是一次真实 HTTP GET，触发 Next dev 的路由编译。 */
const ROUTES = [
  // CopilotRuntime 适配器（`/api/copilotkit/*`）——面板挂载即打它，独立编译单元。
  "/api/copilotkit/info",
  // 正式入口：v2 分支 + 旧屏两支共用的同一个 page 模块。
  "/chat",
  // 动态段：`/chat/[threadId]`，与裸段是两个编译单元（`copilotkit-v2-skill-mount.spec.ts`
  // 早就单独焐过它，那条实测记录仍适用，只是地址从 `/chat/copilotkit-v2/…` 平移过来）。
  "/chat/warmup-route-compile-only",
  // 登录页：每个 spec 的第一步都是它，同样只该付一次编译。
  "/login",
  // Successful login navigates here before entering chat. Compile it outside the
  // scenario budget, just like the chat routes, so login isn't blamed for bundling.
  "/projects",
];

const WARMUP_BUDGET_MS = 300_000;

export default async function warmUpChatRoutes(): Promise<void> {
  if (!WEB_PORT) {
    throw new Error("WORKSPACEX_WEB_PORT is required; run through the root #74 isolation wrapper (pnpm run verify:chat-read)");
  }
  const base = `http://127.0.0.1:${WEB_PORT}`;
  for (const route of ROUTES) {
    const deadline = Date.now() + WARMUP_BUDGET_MS;
    let lastOutcome = "never attempted";
    for (;;) {
      try {
        const response = await fetch(`${base}${route}`, { redirect: "manual" });
        // 2xx 与 3xx 都算编译完成：`/chat/copilotkit-v2` 那类薄 redirect 返回 307，
        // 未登录的 `/chat` 由客户端壳层跳 `/login`（服务端仍是 200）。只有网络层
        // 失败或 5xx 才说明这一轮还没编译好。
        if (response.status < 500) break;
        lastOutcome = `HTTP ${response.status}`;
      } catch (failure) {
        lastOutcome = failure instanceof Error ? failure.message : String(failure);
      }
      if (Date.now() >= deadline) {
        throw new Error(`[chat-route-warmup] ${route} 在 ${WARMUP_BUDGET_MS}ms 内没有编译就绪：${lastOutcome}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
