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
 * model / mcp / blueprint 等仍在吃 mock 的屏，把它们拽进本断言等于让 #458
 * 去背别人的债。这个残留已在 issue #458 的评论里报给 coord，不在本 issue 范围内。
 * 这段话是**限制说明**，不是免责声明：下面第三条断言把「外壳只从 mock 拿类型」钉死，
 * 一旦有人从那里拿到运行时的值，它会红。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 只认静态 import/export-from：动态 `import()` 也一并抓，漏掉它等于留了一扇后门。 */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null; // 裸包名：node_modules，不是本仓源码
  for (const candidate of [
    base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`,
  ]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // 目录本身：继续试带扩展名的候选
      }
    }
  }
  return null;
}

/** 从 entry 出发的传递闭包，返回 [被走到的模块, 命中的 mock 依赖边]。 */
function walk(entry: string): { visited: string[]; mockEdges: string[] } {
  const start = resolve(ROOT, entry);
  expect(existsSync(start), `${entry} 不存在——入口写错了，断言会空转`).toBe(true);
  const visited = new Set<string>();
  const mockEdges: string[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const target = resolveModule(file, specifier);
      if (target === null) continue;
      if (relative(ROOT, target).startsWith("lib/mock/")) {
        mockEdges.push(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`);
        continue;
      }
      queue.push(target);
    }
  }
  return { visited: [...visited].map((f) => relative(ROOT, f)).sort(), mockEdges };
}

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
    const { mockEdges } = walk("components/admin/model-screen.tsx");
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
