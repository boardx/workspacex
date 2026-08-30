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
 * ② `next.config.mjs` 的 `rewrites()` 真的会在 `beforeFiles` 位置拦截带
 *    `projectId`/`thread` 的 `/chat` 深链——这条 rewrite 存在的意义就是让
 *    `(v2)/page.tsx` 不需要再判断 query string，从而不会被迫兼容旧屏、不会双重
 *    AppShell（layout 头注有完整推导）。
 * ③ 两个 page.tsx 渲染的都是同一个 `CopilotKitV2Shell`——这是"AppShell 持久、只有
 *    右侧内容切换"这句话在结构上成立的前提：如果两个 page 渲染的不是同一个组件，
 *    "只刷新右侧内容区"就无从谈起。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("next.config.mjs 在 beforeFiles 位置拦截带 projectId/thread 的 /chat 深链到 /chat/legacy", async () => {
    const config = (await import("../../next.config.mjs")).default;
    const rewrites = await config.rewrites();
    const beforeFiles = Array.isArray(rewrites) ? [] : (rewrites.beforeFiles ?? []);

    const chatRewrites = beforeFiles.filter(
      (rule: { source: string }) => rule.source === "/chat",
    );
    expect(chatRewrites).toHaveLength(2);
    expect(chatRewrites.every((rule: { destination: string }) => rule.destination === "/chat/legacy")).toBe(true);

    const keys = chatRewrites.map(
      (rule: { has: readonly { key: string }[] }) => rule.has[0]!.key,
    ).sort();
    expect(keys).toEqual(["projectId", "thread"]);
  });
});
