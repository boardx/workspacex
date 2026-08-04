/**
 * #467 通用验收条款①的机械形态：**正式 `/chat` 这条会话路径不再从 `lib/mock/**` 取数。**
 *
 * 用的是 #458 立下的**闭包走图**写法（`tests/support/import-graph.ts`），
 * **不是** `covered-routes-no-mock.test.ts` 的单文件字符串检查——后者在
 * 「屏干净、子组件仍吃 mock」时会照样变绿，而那正是本仓 mock 依赖的真实失效方式。
 *
 * ## 覆盖到哪里
 *
 * `components/chat/chat-read-screen.tsx` 的整棵依赖树：读编制（`getAgentPanel`）、
 * 改编制（`updateAgentRoster`）、消息面板，直到 `lib/live-chat.ts` → `lib/api-client.ts`。
 *
 * ## ⚠ 范围诚实
 *
 * 本文件断言的是**取数不经 mock**，**不是**「agent 真的执行并产生回复」。
 * `capability-catalog-screen.tsx` 那句自陈「出现在目录中不代表已经具备可执行的
 * AgentRun 或 Skill 运行时」在本文件全绿之后**依然成立**。
 * 原型屏 `/chat` 之外的 `components/chat/chat-main.tsx` 一线仍然吃 mock（见下面
 * 的反证），那是原型屏，不在本 issue 范围内，这里如实钉住而不假装已清理。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { walkImports } from "../support/import-graph";

const ROOT = process.cwd();
const CHAT_ENTRY = "components/chat/chat-read-screen.tsx";

describe("#467 正式 /chat 的编制读写路径不依赖 lib/mock", () => {
  it("会话屏的整棵依赖树里没有任何一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walkImports(CHAT_ENTRY);
    expect(mockEdges).toEqual([]);
    // 反空转：这棵树必须真的走到了取数与写入两端，否则「没有 mock」是因为什么都没走。
    expect(visited).toContain("lib/live-chat.ts");
    expect(visited).toContain("lib/api-client.ts");
    expect(visited).toContain("components/chat/chat-live-message-panel.tsx");
  });

  it("写路径打的是契约推导出的真实端点，且不手抄第二份路径", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-chat.ts"), "utf8");
    expect(client).toContain("chat.operations.updateAgentRoster.path");
    // 手抄一份就会在契约改路径时悄悄漂移。
    expect(client).not.toMatch(/["']\/chat\/threads\/[^"']*\/agents["']/);
  });

  it("全仓只有 lib/live-chat.ts 一个改编制的出口：多一个 = 多一处会漂移的请求体", () => {
    const { visited } = walkImports(CHAT_ENTRY);
    const callers = visited.filter((f) =>
      readFileSync(resolve(ROOT, f), "utf8").includes("updateAgentRoster.path"));
    expect(callers).toEqual(["lib/live-chat.ts"]);
  });

  /* ── 反证 ────────────────────────────────────────────────────────────────
   * 没有下面两条，第一条断言可能只是因为走图器解析不出任何 import 而恒为空。 */

  it("反证①：同一个走图器对仍在吃 mock 的原型屏会报出 mock 边", () => {
    const { mockEdges } = walkImports("components/chat/chat-left-panel.tsx");
    expect(mockEdges.length).toBeGreaterThan(0);
    expect(mockEdges.join("\n")).toContain("lib/mock/");
  });

  /**
   * 反证②：**一跳与两跳**——证明断言走的是传递闭包，不是字符串匹配。
   *
   * `chat-left-panel.tsx` 自己 `import ... from "@/lib/mock/chat"`（**一跳**），
   * 同时又 `import { ChatTeamPanel } from "./chat-team-panel"`，而
   * `chat-team-panel.tsx` 才是 `import { TEAM_AGENTS } from "@/lib/mock/chat"`
   * 的那个文件（**两跳**）。
   *
   * 一个只查根文件的实现只会报出第一条边。所以这里要求边集合里**存在一条源头
   * 不是入口自己的边**——那条只有真的走进子模块才拿得到。
   */
  it("反证②：报出的 mock 边里存在两跳的那条（源头不是入口文件自己）", () => {
    const entry = "components/chat/chat-left-panel.tsx";
    const { mockEdges } = walkImports(entry);

    const oneHop = mockEdges.filter((edge) => edge.startsWith(`${entry} ->`));
    const twoHop = mockEdges.filter((edge) => !edge.startsWith(`${entry} ->`));

    expect(oneHop.length).toBeGreaterThan(0);   // 一跳确实存在
    expect(twoHop.length).toBeGreaterThan(0);   // ⚠ 关键：两跳也被走到了
    expect(twoHop.join("\n")).toContain("components/chat/chat-team-panel.tsx -> lib/mock/chat");
  });

  it("反证③：入口写错时抛出，而不是安静地返回空边集合", () => {
    expect(() => walkImports("components/chat/this-file-does-not-exist.tsx")).toThrow(/入口不存在/);
  });
});
