/**
 * #458 通用验收条款①的机械形态：**Agent 目录这条用户路径不再从 `lib/mock/**` 取数。**
 *
 * ## 为什么是走图，不是 grep 一个文件
 *
 * `covered-routes-no-mock.test.ts` 对单个文件做字符串断言，它防的是「这个文件里写了
 * mockIdentity」。但 mock 依赖的真实失效方式是**间接的**：屏组件干干净净，
 * 它引的某个子组件里 `import { MOCK_AGENTS } from "@/lib/mock/agent-runtime"`。
 * 只查根文件的断言对此**全绿**。所以这里从入口开始把 import 图**传递闭包**走完。
 *
 * ## 覆盖到哪里，以及**没有**覆盖到哪里
 *
 * 覆盖：`components/admin/agent-screen.tsx` 的整棵依赖树（→ 目录屏 → 写入口 →
 * `lib/live-capabilities.ts` → `lib/api-client.ts`），也就是 `/admin/agent` 这条路由
 * 真正用来取数与写入的全部模块。
 *
 * ⚠ **不**覆盖 `app/admin/[module]/page.tsx` 这个外壳本身。它 `import type
 * { AdminModuleKey } from "@/lib/mock/admin"`——一个**类型**导入（左栏模块键的联合类型），
 * 编译后不产生任何运行时依赖，也不给 Agent 目录提供任何数据；而那个外壳同时挂着
 * mcp / blueprint 等仍在吃 mock 的屏（#1381 起 model 屏的列表读真实 `GET /models` 了，
 * 从这份「仍在吃 mock」名单里摘掉），把它们拽进本断言等于让 #458
 * 去背别人的债。这个残留已在 issue #458 的评论里报给 coord，不在本 issue 范围内。
 * 这段话是**限制说明**，不是免责声明：下面第三条断言把「外壳只从 mock 拿类型」钉死，
 * 一旦有人从那里拿到运行时的值，它会红。
 *
 * ## 走图器本体已抽到 `./import-closure`（#520）
 *
 * 第二个调用方（`skill-create-route-no-mock.test.ts`）出现时，复制一份走图器就等于
 * 让「不吃 mock」这条判定标准存在两个会各自演化的版本。所以它搬去了 `import-closure.ts`，
 * 本文件的断言一字未改。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, walk } from "./import-closure";

const AGENT_ENTRY = "components/admin/agent-screen.tsx";

describe("#458 /admin/agent 的取数与写入路径不依赖 lib/mock", () => {
  it("Agent 屏的整棵依赖树里没有任何一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walk(AGENT_ENTRY);
    expect(mockEdges).toEqual([]);
    // 反空转：这棵树必须真的走到了取数与写入这两端，否则「没有 mock」是因为什么都没走。
    expect(visited).toContain("components/admin/capability-catalog-screen.tsx");
    expect(visited).toContain("components/admin/capability-mutate.tsx");
    expect(visited).toContain("lib/live-capabilities.ts");
    expect(visited).toContain("lib/api-client.ts");
  });

  it("反证：同一个走图器对仍在吃 mock 的屏会报出 mock 边", () => {
    // 没有这条，上面那条断言可能只是因为走图器解析不出任何 import 而恒为空。
    // ⚠ #1381 之前这里用的是 `model-screen.tsx`——它现在读真实 `GET /models`
    //  （`lib/live-model.ts`），不再有任何 `lib/mock` 边，于是这条反证换了个仍然
    //  纯 mock 的屏（MCP 后台页，零后端，见 `lib/mock/admin.ts` 的 MCP 清单）。
    const { mockEdges } = walk("components/admin/mcp-screen.tsx");
    expect(mockEdges.length).toBeGreaterThan(0);
    expect(mockEdges.join("\n")).toContain("lib/mock/");
  });

  it("写路径打的是已签契约的真实端点，且不存在第二个 mutate 出口", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-capabilities.ts"), "utf8");
    expect(client).toContain("identity.operations.mutateCapability.path");
    expect(client).not.toMatch(/["']\/capabilities\/mutate["']/); // 路径不得手抄一份

    // 全仓只有这一个文件调 mutate 端点：多一个出口 = 多一处会漂移的请求体。
    const { visited } = walk(AGENT_ENTRY);
    const callers = visited.filter((f) =>
      readFileSync(resolve(ROOT, f), "utf8").includes("mutateCapability.path"));
    expect(callers).toEqual(["lib/live-capabilities.ts"]);
  });

  it("外壳从 lib/mock 只拿类型：一旦拿到运行时的值，这条会红", () => {
    const page = readFileSync(resolve(ROOT, "app/admin/[module]/page.tsx"), "utf8");
    // ⚠ 刻意用 `[^\n;]` 而不是 `[\s\S]`：后者会从更早的一条 import 起头一路跨行匹配到
    //   mock 那一行，把别人的 import 子句当成本条的子句。第一版就是这么写的，
    //   它红了——留下这条注释，免得有人「顺手改回去」。
    const mockImports = [...page.matchAll(/^import\s+([^\n;]*?)\s+from\s+["']@\/lib\/mock\/[^"']+["'];?$/gm)];
    expect(mockImports.length).toBeGreaterThan(0); // 残留确实还在——如实钉住，不假装已清理
    for (const [, clause] of mockImports) {
      expect(clause!.trimStart().startsWith("type ")).toBe(true);
    }
    // 并且 agent 段确实落在被上面几条覆盖的那个屏上。
    expect(page).toMatch(/agent:\s*AgentScreen/);
  });
});
