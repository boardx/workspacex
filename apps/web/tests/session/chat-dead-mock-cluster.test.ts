/**
 * #462：**正式 `/chat` 这条路由的闭包里不得有 mock 边**，且 chat 下**任何路由都走不到、
 * 却仍吃 mock 的那一簇文件**必须逐条上台账，只能可见地缩小。
 *
 * ## 为什么要有这份，而 #467 那份还不够
 *
 * `chat-roster-route-no-mock.test.ts`（#467）从**组件** `components/chat/chat-read-screen.tsx`
 * 起走。本文件从**路由** `app/chat/page.tsx` 起走：路由外壳日后多挂一个吃 mock 的
 * 兄弟组件时，#467 那条**照样绿**——那个兄弟不在 read-screen 的子树里。
 *
 * ## ⚠ 本文件断言的**不是**「chat 已经没有 mock 了」
 *
 * chat 下有一簇**任何路由都走不到**的吃 mock 组件（原型期遗留）。它们不在 `/chat`
 * 闭包里，所以「零 mock 边」那条对它们**全绿**——统计「前端还剩多少 mock」的人会
 * 因此得到一个偏乐观的数。#461/#462 正是这么把判断带偏的：有人按
 * `grep -rn "components/chat/composer"` 得出 `composer.tsx` 零引用者，
 * 而它真实的引用者写的是**相对路径** `./composer`（`chat-main.tsx:11`）——
 * 那条 grep 形式漏掉了它。⇒ 本文件下面用**走图**而不是 grep 来钉这件事。
 *
 * 台账用 `toEqual` 双向咬合：**新增一个会红，清理一个也会红**，逼人来改这份清单。
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { walkImports } from "../support/import-graph";

const ROOT = process.cwd();
const CHAT_ROUTE = "app/chat/page.tsx";

/** `app/**` 下全部路由入口（page / layout / route），走图的起点集合。 */
function routeEntries(dir = "app"): string[] {
  const out: string[] = [];
  for (const item of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${item.name}`;
    if (item.isDirectory()) out.push(...routeEntries(rel));
    else if (/^(page|layout|route)\.tsx?$/.test(item.name)) out.push(rel);
  }
  return out;
}

/** `components/chat/` 下的全部组件文件。 */
function chatComponents(): string[] {
  return readdirSync(resolve(ROOT, "components/chat"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `components/chat/${name}`)
    .sort();
}

describe("#462 /chat 路由闭包禁 mock + chat 死 mock 簇台账", () => {
  /* ── 先跑反证：没有这三条，下面的 `toEqual([])` 可能只是走图器恒空 ────────── */

  it("反证①：同一台走图器对仍在吃 mock 的原型屏会报出 mock 边", () => {
    const { mockEdges } = walkImports("components/chat/chat-left-panel.tsx");
    expect(mockEdges.length).toBeGreaterThan(0);
    expect(mockEdges.join("\n")).toContain("lib/mock/chat");
  });

  it("反证②：报出的边里存在两跳的那条，证明走的是传递闭包而不是单文件字符串检查", () => {
    const entry = "components/chat/chat-left-panel.tsx";
    const { mockEdges } = walkImports(entry);
    const twoHop = mockEdges.filter((edge) => !edge.startsWith(`${entry} ->`));
    expect(twoHop.length).toBeGreaterThan(0);
    expect(twoHop.join("\n")).toContain("components/chat/chat-team-panel.tsx -> lib/mock/chat");
  });

  it("反证③：入口写错或入口为空时抛出，而不是安静地返回空闭包", () => {
    expect(() => walkImports("app/chat/this-route-does-not-exist.tsx")).toThrow(/入口不存在/);
    expect(() => walkImports([])).toThrow(/入口为空/);
  });

  /* ── 主张 ─────────────────────────────────────────────────────────────── */

  it("从路由 app/chat/page.tsx 起走，整棵闭包里没有一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walkImports(CHAT_ROUTE);
    expect(mockEdges).toEqual([]);
    // 反空转：这棵树必须真的走到取数与发消息两端，否则「没有 mock」是因为什么都没走。
    expect(visited).toContain("components/chat/chat-read-screen.tsx");
    expect(visited).toContain("components/chat/chat-live-message-panel.tsx");
    expect(visited).toContain("lib/live-chat.ts");
    expect(visited).toContain("lib/api-client.ts");
  });

  /**
   * 台账：`components/chat/` 下**任何路由都走不到**、却仍 import `lib/mock/**` 的文件。
   *
   * ⚠ 这七个**不是**「顺手就能删的死代码」，删除已从 #462 的范围里拿掉、上报待裁：
   * · 它们不是各自孤立的，而是一条**链**：`chat-main.tsx` → `composer.tsx` →
   *   `composer-settings.tsx`，`chat-main.tsx` 还牵着 `message-stream` / `reassign-bar`。
   *   只删链尾会当场把 `chat-main.tsx` 的 typecheck 打红（实测：
   *   `error TS2307: Cannot find module './composer'`）。
   * · `chat-main` / `chat-left-panel` / `chat-right-panel` 被 `app/chat/live/page.tsx`
   *   的注释指名为**已签核的原型屏**，`phases/phase-01-run-a-project/contracts/chat/ui.md:69`
   *   也把 `composer.tsx` / `composer-settings.tsx` 登记为输入区的设计材料。
   *   删掉整条链 = 扔掉已签核的 UI 材料，那是签核动作，不是 p2 清理动作。
   * · `composer-settings.tsx` 还被 `tests/single-source-of-truth.test.ts:247` 按文件读取。
   *
   * 所以这里如实钉住而不假装已清理，也不偷偷删。
   */
  it("如实钉住：chat 下路由走不到、却仍吃 mock 的文件正好是这七个", () => {
    const { visited } = walkImports(routeEntries());
    // 反空转：全路由闭包必须真的走到了活着的 chat 屏，否则「都走不到」是因为什么都没走。
    expect(visited).toContain("components/chat/chat-read-screen.tsx");
    expect(visited).toContain("components/chat/chat-left-panel.tsx");

    const orphanMockFiles = chatComponents().filter((file) =>
      !visited.includes(file) && readFileSync(resolve(ROOT, file), "utf8").includes("@/lib/mock/"));

    expect(orphanMockFiles).toEqual([
      "components/chat/ai-message.tsx",        // UC-8.2 AI 消息气泡
      "components/chat/approval-card.tsx",     // UC-8.2 批准卡（后端无审批路由）
      "components/chat/chat-main.tsx",         // UC-8.2 三栏原型主区：整条链的根，零引用者
      "components/chat/composer-settings.tsx", // 输入区「更多设置」，被 composer.tsx 引
      "components/chat/composer.tsx",          // 输入区：**唯一引用者是 chat-main.tsx:11 的 `./composer`**
      "components/chat/message-stream.tsx",    // UC-8.2 转录流
      "components/chat/reassign-bar.tsx",      // UC-8.2 改派建议（后端无改派路由）
    ]);
  });

  /**
   * 把「为什么删不动」钉成机械事实，而不是只写在注释里：
   * `composer.tsx` 的引用者非空（所以「零引用者，直接删」这个前提是假的），
   * 且那个引用者自己零引用者（所以它确实是**整条链一起死**，不是活代码）。
   */
  it("死链的形状：composer 的唯一引用者是 chat-main，而 chat-main 零引用者", () => {
    const sources = [...chatComponents(), ...routeEntries()];
    const importersOf = (name: string) => sources.filter((file) => {
      const text = readFileSync(resolve(ROOT, file), "utf8");
      return new RegExp(`from\\s+["'](?:\\./|@/components/chat/)${name}["']`).test(text);
    });

    expect(importersOf("composer")).toEqual(["components/chat/chat-main.tsx"]);
    expect(importersOf("chat-main")).toEqual([]);
    // 正样本对照：同一台匹配器对活着的屏必须报出真实引用者，否则它对谁都返回空。
    // ⚠ #467 起有**两个**引用者：新加的 skill 挂载面板复用了本文件导出的
    //   `describeMessageFailure`（同一套失败文案，不另写第二份）。#594 起
    //   有**三个**：`PersonalChatScreen`（个人对话，无项目）复用同一个消息面板，
    //   不另起第二套发消息/看回复实现。台账双向咬合，所以这里如实列三个而不是
    //   放宽成 `toContain`——再多一个引用者仍然要有人来改这行。
    expect(importersOf("chat-live-message-panel")).toEqual([
      "components/chat/chat-read-screen.tsx",
      "components/chat/chat-skill-mount-panel.tsx",
      "components/chat/personal-chat-screen.tsx",
    ]);
  });

  /**
   * 台账：**chat 各路由闭包里**残留的 mock 边（原型路由 `/chat/landing`、`/chat/preset`）。
   * 正式 `/chat` 与 `/chat/live` 各自贡献 0 条——上面已单独钉住 `/chat`。
   */
  it("如实钉住：chat 四条路由的闭包里残留的 mock 边正好是这几条", () => {
    const chatRoutes = routeEntries().filter((f) => f.startsWith("app/chat/"));
    // 反空转：四条路由都必须在场，少一条会让下面的边集合悄悄变小。
    expect(chatRoutes.sort()).toEqual([
      "app/chat/landing/page.tsx",
      "app/chat/live/page.tsx",
      "app/chat/page.tsx",
      "app/chat/preset/page.tsx",
    ]);

    const { mockEdges } = walkImports(chatRoutes);
    expect([...new Set(mockEdges)].sort()).toEqual([
      // `/chat/landing`：已签核原型屏，后端无对应路由。
      // ⚠ 路由外壳自身**不引** mock（第一版台账把 `app/chat/landing/page.tsx -> …`
      //   也写了进去，那一条是凭印象编的，跑出来就红——留此注记提醒台账只能来自实测）。
      "components/chat/chat-left-panel.tsx -> lib/mock/chat.ts",
      "components/chat/chat-right-panel.tsx -> lib/mock/chat.ts",
      "components/chat/chat-team-panel.tsx -> lib/mock/chat.ts",
      "components/chat/landing-panel.tsx -> lib/mock/chat.ts",
      // `/chat/preset`：预设三件套的展示字段仍取自 mock
      "components/chat/preset-dispatch.tsx -> lib/mock/chat.ts",
      "components/chat/visibility-badge.tsx -> lib/mock/chat.ts",
    ]);
  });

  /**
   * `chat-composer-input` 这个 testid **只**定义在路由走不到的 `composer.tsx` 里 ⇒
   * 它从来没有被任何路由渲染过，引用它的 e2e 断言永远走不到。
   *
   * 发消息的真实入口是 #429 交付的 `chat-message-input` / `chat-message-submit`
   * （`components/chat/chat-live-message-panel.tsx`），在 `/chat` 闭包里。
   * 这条把两者的可达性差异钉死，免得下一个人再拿 `chat-composer-input` 当验收锚点。
   */
  it("chat-composer-input 位于路由走不到的文件里；真实发消息锚点在 /chat 闭包内", () => {
    const { visited } = walkImports(routeEntries());
    const definedIn = (testId: string) => chatComponents().filter((file) =>
      readFileSync(resolve(ROOT, file), "utf8").includes(`data-testid="${testId}"`));

    expect(definedIn("chat-composer-input")).toEqual(["components/chat/composer.tsx"]);
    expect(visited).not.toContain("components/chat/composer.tsx");

    expect(definedIn("chat-message-input")).toEqual(["components/chat/chat-live-message-panel.tsx"]);
    expect(definedIn("chat-message-submit")).toEqual(["components/chat/chat-live-message-panel.tsx"]);
    expect(visited).toContain("components/chat/chat-live-message-panel.tsx");
  });
});
