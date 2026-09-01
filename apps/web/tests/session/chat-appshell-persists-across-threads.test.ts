/**
 * issue #2067 —— 切换 thread 时 AppShell 整体重挂载的回归守卫。
 *
 * 真正的端到端证据（"切换两次线程，AppShell 挂载日志只打印一次"）需要真实浏览器/
 * Next dev server，本仓当前沙箱没有 docker，跑不了 `playwright.fullstack-smoke`。
 * 这里退而求其次，用静态断言钉住修复赖以成立的结构性事实：
 *
 * ① AppShell 只在共享的 `(v2)/layout.tsx` 里出现一次，两个 page.tsx 都不再自己
 *    组合 AppShell——如果哪天有人往 page.tsx 里加回 `<AppShell>`，就会在这两个 page
 *    与 layout 之间产生双重包裹（历史根因正是"每个 page 各自重新组合整棵树"）。
 * ② `next.config.mjs` 的 `rewrites()` 真的会在 `beforeFiles` 位置把带 `thread`
 *    的 `/chat` 深链拦到 `/chat/:threadId`——这条 rewrite 存在的意义就是让
 *    `(v2)/page.tsx` 不需要再判断 query string。issue #2457（DA-19h，人类
 *    2026-09-01 二次确认正式退役）起，`/chat/legacy` 分支与 `ChatReadScreen`/
 *    `PersonalChatScreen`/`ChatLiveMessagePanel` 三个组件已经整体删除，
 *    `projectId` 参数不再有任何特殊路由语义。
 * ③ 两个 page.tsx 渲染的都是同一个 `CopilotKitV2Shell`——这是"AppShell 持久、只有
 *    右侧内容切换"这句话在结构上成立的前提：如果两个 page 渲染的不是同一个组件，
 *    "只刷新右侧内容区"就无从谈起。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// next.config is executable ESM JavaScript and intentionally has no standalone declaration
// file — same cast convention as `tests/research-rewrite.test.ts`.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../../next.config.mjs";

type Rewrite = {
  readonly source: string;
  readonly destination: string;
  readonly has?: readonly { readonly key: string }[];
  readonly missing?: readonly { readonly key: string }[];
};
const nextConfig = rawNextConfig as {
  rewrites(): Promise<{ readonly beforeFiles: readonly Rewrite[] }>;
};

const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("#2067 AppShell 持久化：路由组结构", () => {
  it("AppShell 只在共享 layout 里出现，两个 page.tsx 都不再自己组合它", () => {
    const layout = read("app/chat/(v2)/layout.tsx");
    const barePage = read("app/chat/(v2)/page.tsx");
    const threadPage = read("app/chat/(v2)/[threadId]/page.tsx");

    expect(layout).toContain("<AppShell");
    expect(barePage).not.toContain("<AppShell");
    expect(threadPage).not.toContain("<AppShell");
  });

  it("两个 page.tsx 渲染的是同一个 CopilotKitV2Shell，不是各自另起一棵树", () => {
    const barePage = read("app/chat/(v2)/page.tsx");
    const threadPage = read("app/chat/(v2)/[threadId]/page.tsx");

    expect(barePage).toContain("CopilotKitV2Shell");
    expect(threadPage).toContain("CopilotKitV2Shell");
  });

  it("issue #2457（DA-19h 正式退役）：next.config.mjs 只剩一条 /chat 深链规则，thread 深链拦到 /chat/:threadId", async () => {
    const { beforeFiles } = await nextConfig.rewrites();

    const chatRewrites = beforeFiles.filter((rule) => rule.source === "/chat");
    // `/chat/legacy` 分支（projectId → 旧屏）已随三个旧组件一起整体删除——
    // 项目内对话不是"暂不支持迁移"，是彻底停用（人类 2026-09-01 二次确认）。
    expect(chatRewrites).toHaveLength(1);

    const threadRule = chatRewrites[0];
    expect(threadRule?.destination).toBe("/chat/:threadId");
    expect(threadRule?.has?.[0]?.key).toBe("thread");
    // 不再需要 `missing: projectId` 互斥——`projectId` 参数已经没有任何特殊路由
    // 语义，只有一条规则，没有第二条规则要跟它互斥。
    expect(threadRule?.missing).toBeUndefined();
  });
});
