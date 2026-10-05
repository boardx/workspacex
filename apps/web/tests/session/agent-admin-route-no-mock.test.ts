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
 * ⚠ 不把平台动态外壳挂载的其他屏纳入 Agent 业务数据闭包；它们有各自验收。
 * #5376 已将外壳使用的 AdminModuleKey 移至纯导航元数据，不再残留 mock 类型导入。
 * 下方单独检查外壳的直接模块引用，并用注入 mock 引用的反例保护这条边界。
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
import * as ts from "typescript";

const AGENT_ENTRY = "components/admin/agent-screen.tsx";
// Parse module syntax: comments mentioning old mock debt are not imports.
function directMockReferences(source: string): string[] {
  const file = ts.createSourceFile("platform-page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const collect = (value: ts.Node | undefined) => {
    if (value && ts.isStringLiteral(value) && /(?:^|\/)lib\/mock\//.test(value.text)) found.push(value.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) collect(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) collect(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

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
    //  （`lib/live-model.ts`），不再有任何 `lib/mock` 边；2026-09-02 之后 `mcp-screen.tsx`
    //  也只读真实 `listMcpServers`（六台示例服务器随简化一起撤了），于是这条反证再换
    //  一个仍然引用 mock 的屏：成员配额屏的邀请/待激活区仍读 `lib/mock/org-admin.ts`
    //  （`members-screen.tsx` 头注写明了这一点）。
    const { mockEdges } = walk("components/admin/members-screen.tsx");
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

  it("动态外壳直接模块引用不含 mock，类型来自纯导航元数据", () => {
    const page = readFileSync(resolve(ROOT, "app/platform-admin/[module]/page.tsx"), "utf8");
    expect(directMockReferences(page)).toEqual([]);
    expect(page).toContain('import type { AdminModuleKey } from "@/lib/admin-nav-metadata"');
    // The Agent segment must still resolve to the already verified real screen.
    expect(page).toMatch(/agent:\s*AgentScreen/);
    expect(walk("lib/admin-nav-metadata.ts").mockEdges).toEqual([]);
  });

  it.each([
    'import { ADMIN_NAV } from "@/lib/mock/admin";',
    'import type { AdminModuleKey } from "@/lib/mock/admin";',
    'import {\n ADMIN_NAV\n} from "@/lib/mock/admin";',
    'import "@/lib/mock/admin";',
    'export { ADMIN_NAV } from "@/lib/mock/admin";',
    'const load = () => import("@/lib/mock/admin");',
  ])("反证：外壳重新引入 mock 模块会被识别：%s", (introduced) => {
    const page = readFileSync(resolve(ROOT, "app/platform-admin/[module]/page.tsx"), "utf8");
    expect(directMockReferences(`${page}\n${introduced}`)).toEqual(["@/lib/mock/admin"]);
  });

  it("旧路由 /admin/agent 只剩重定向到 /platform-admin/agent，不再自己渲染 AgentScreen", () => {
    // 2026-09-02 AI 能力归平台后台：旧外壳若还自己落地 AgentScreen，就是同一个屏两处入口。
    const legacy = readFileSync(resolve(ROOT, "app/admin/[module]/page.tsx"), "utf8");
    expect(legacy).toMatch(/agent:\s*["']\/platform-admin\/agent["']/);
    expect(legacy).not.toMatch(/agent:\s*AgentScreen/);
    expect(legacy).not.toContain("agent-screen");
  });
});
