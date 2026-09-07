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
 *    `projectId` 的 `/chat` 深链去 `/chat/legacy`——这条 rewrite 存在的意义就是让
 *    `(v2)/page.tsx` 不需要再判断 query string，从而不会被迫兼容旧屏、不会双重
 *    AppShell（layout 头注有完整推导）。issue #2457 起，只带 `thread`（不带
 *    `projectId`）的纯个人线程深链已经改拦到 `/chat/:threadId`，继续走 v2——
 *    项目内对话本轮不支持迁移，是唯一还落在 `/chat/legacy` 的场景。
 * ③ `CopilotKitV2Shell` 由 layout 挂载、两个 page.tsx 都**不**再渲染它——2026-09-02
 *    第五轮实测根因：`[threadId]` 是动态段，page 级挂载的壳在每次线程切换时被整个
 *    卸载重建，壳内为"快速切换不跳"做的全部记忆随实例丢失（`copilotkit-v2-shell-route.tsx`
 *    头注有完整推导）。哪天有人把 `<CopilotKitV2Shell` 加回任一 page.tsx，切换线程
 *    就会重新开始跳。
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

  it("CopilotKitV2Shell 只由共享 layout 挂载一次；两个 page.tsx 都不再渲染它（否则动态段每次切换都会把壳整个重建）", () => {
    const layout = read("app/chat/(v2)/layout.tsx");
    const route = read("components/chat/copilotkit-v2-shell-route.tsx");
    const barePage = read("app/chat/(v2)/page.tsx");
    const threadPage = read("app/chat/(v2)/[threadId]/page.tsx");

    expect(layout).toContain("<CopilotKitV2ShellRoute");
    expect(route).toContain("<CopilotKitV2Shell");
    expect(route).toContain("useParams");
    // 反证面：page 里只允许在注释中提到壳的名字，不允许再渲染它。
    expect(barePage).not.toMatch(/<CopilotKitV2Shell/);
    expect(threadPage).not.toMatch(/<CopilotKitV2Shell/);
    expect(barePage).not.toMatch(/^import .*CopilotKitV2Shell/m);
    expect(threadPage).not.toMatch(/^import .*CopilotKitV2Shell/m);
  });

  it("项目和个人线程统一进入 v2，不再按 projectId 转到 legacy", async () => {
    const { beforeFiles } = await nextConfig.rewrites();
    expect(beforeFiles.some((rule) => rule.destination === "/chat/legacy")).toBe(false);
    expect(beforeFiles.filter((rule) => rule.source === "/chat")).toHaveLength(1);
  });

  it("issue #2457：只带 thread（不带 projectId）的纯个人线程深链改拦到 /chat/:threadId，继续走 v2", async () => {
    const { beforeFiles } = await nextConfig.rewrites();

    const chatRewrites = beforeFiles.filter((rule) => rule.source === "/chat");
    const threadRule = chatRewrites.find((rule) => rule.destination === "/chat/:threadId");

    expect(threadRule?.has?.[0]?.key).toBe("thread");
    // `missing: projectId` 让这条规则与上面那条互斥，不依赖数组顺序里
    // "谁先匹配谁生效" 这种隐式行为（issue #2459 已核实 v2 侧的
    // 历史回填/线程列表选中态/URL 持久化全部已具备，不需要额外开发）。
    expect(threadRule?.missing?.[0]?.key).toBe("projectId");
  });
});
