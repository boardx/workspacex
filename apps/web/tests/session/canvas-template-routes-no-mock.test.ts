/**
 * #464 通用验收条款①的机械形态：**画布模板这两条用户路径不再从 `lib/mock/**` 取运行时数据。**
 *
 * ## 走图，不是 grep 一个文件
 *
 * 与 `agent-admin-route-no-mock.test.ts` 同一台走图器（此处独立实现，因为那份是 #458
 * 的断言、不该被本 issue 改动）。只查根文件的字符串断言防不住真正的失效方式：
 * 屏组件干干净净，它引的某个子组件里 `import { A0_TEMPLATES } from "@/lib/mock/canvas"`。
 *
 * ## 覆盖到哪里
 *
 * ① `components/canvas/template-admin.tsx` —— `/canvas?screen=template-admin` 的取数与写入屏。
 * ② `components/admin/canvas-template-screen.tsx` —— `/admin/canvasadmin` 的落点屏。
 * 两棵树都必须走到 `lib/live-canvas.ts` → `lib/api-client.ts`，否则「没有 mock 边」
 * 可能只是因为什么都没走到。
 *
 * ## ⚠ 明确**没有**覆盖到哪里（限制说明，不是免责声明）
 *
 * `/canvas` 这条路由是一个六屏 hub。#463 交付的后端只有模板注册表的五条路由
 * （list / publish / trial / archive / restore），另外四屏——模板编辑器、环节绑定、
 * AI 起草留白、回流知识图谱——**后端一条路由都没有**，因此它们仍是 mock 原型。
 * 把它们拽进本断言，等于让 #464 去背后端还没写的债。
 *
 * 所以下面第三条把「`/canvas` 外壳自身零 mock 依赖」钉死，第四条把**残留的 mock 边逐条列出**
 * 并要求精确相等：新增一条会红，清理一条也会红（逼人来改这份清单，债只能可见地缩小）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 只认静态 import/export-from，外加动态 `import()`——漏掉后者等于留一扇后门。 */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveModule(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null; // 裸包名 = node_modules，不是本仓源码
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (!existsSync(candidate)) continue;
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      // 目录本身：继续试带扩展名的候选
    }
  }
  return null;
}

function walk(entry: string): { visited: string[]; mockEdges: string[] } {
  const start = resolve(ROOT, entry);
  expect(existsSync(start), `${entry} 不存在——入口写错了，断言会空转`).toBe(true);
  const visited = new Set<string>();
  const mockEdges = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const target = resolveModule(file, specifier);
      if (target === null) continue;
      if (relative(ROOT, target).startsWith("lib/mock/")) {
        mockEdges.add(`${relative(ROOT, file)} -> ${relative(ROOT, target)}`);
        continue;
      }
      queue.push(target);
    }
  }
  return {
    visited: [...visited].map((f) => relative(ROOT, f)).sort(),
    mockEdges: [...mockEdges].sort(),
  };
}

const TEMPLATE_ADMIN = "components/canvas/template-admin.tsx";
const CANVASADMIN_SCREEN = "components/admin/canvas-template-screen.tsx";

describe("#464 画布模板两条路径的取数不依赖 lib/mock", () => {
  it("反证：同一个走图器对仍在吃 mock 的屏会报出 mock 边", () => {
    // 先跑这条。没有它，下面的 `toEqual([])` 可能只是因为走图器解析不出任何 import 而恒为空
    // （本仓已九次「全绿但空转」）。用一个**已知仍吃 mock** 的正样本证明正则真的命中。
    const { mockEdges } = walk("components/canvas/segment-binding.tsx");
    expect(mockEdges.length).toBeGreaterThan(0);
    expect(mockEdges.join("\n")).toContain("lib/mock/canvas");
  });

  it("模板库屏（/canvas?screen=template-admin）整棵依赖树里没有一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walk(TEMPLATE_ADMIN);
    expect(mockEdges).toEqual([]);
    // 反空转：这棵树必须真的走到取数那一端。
    expect(visited).toContain("lib/live-canvas.ts");
    expect(visited).toContain("lib/api-client.ts");
  });

  it("后台画布模板屏（/admin/canvasadmin）整棵依赖树里没有一条指向 lib/mock 的边", () => {
    const { visited, mockEdges } = walk(CANVASADMIN_SCREEN);
    expect(mockEdges).toEqual([]);
    expect(visited).toContain("lib/live-canvas.ts");
    expect(visited).toContain("lib/api-client.ts");
  });

  it("/canvas 路由外壳自身不再引 lib/mock，也不再自造身份", () => {
    const page = readFileSync(resolve(ROOT, "app/canvas/page.tsx"), "utf8");
    expect(page).not.toContain("@/lib/mock/");
    expect(page).not.toContain("mockIdentity");
    // 屏注册表搬到了非 mock 的单一事实源，而不是在页面里重抄一份。
    expect(page).toContain('from "@/lib/canvas-screens"');
  });

  it("屏注册表只有一份：lib/mock/canvas 里不得再留一份副本", () => {
    const mock = readFileSync(resolve(ROOT, "lib/mock/canvas.ts"), "utf8");
    expect(mock).not.toContain("CANVAS_SCREENS");
    expect(mock).not.toContain("resolveCanvasScreen");
    const registry = readFileSync(resolve(ROOT, "lib/canvas-screens.ts"), "utf8");
    expect(registry).toContain("CANVAS_SCREENS");
    expect(registry).toContain("resolveCanvasScreen");
  });

  it("真实端点路径从契约取，不手抄；全仓只有一个 canvas 模板出口", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-canvas.ts"), "utf8");
    for (const op of ["listTemplates", "publishTemplate", "trialTemplate", "archiveTemplate", "restoreTemplate"]) {
      expect(client).toContain(`canvas.operations.${op}`);
    }
    // 路径一律来自契约对象：整份文件里不许出现任何手抄的 `/canvas/...` 字面量。
    expect(client).not.toMatch(/["'`]\/canvas\//);
    expect(client).toContain("op.path.replace"); // :key 由契约路径替换而来，不拼字符串

    const callers = [...walk(TEMPLATE_ADMIN).visited, ...walk(CANVASADMIN_SCREEN).visited]
      .filter((f, i, a) => a.indexOf(f) === i)
      .filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("canvas.operations.listTemplates.path"));
    expect(callers).toEqual(["lib/live-canvas.ts"]);
  });

  /**
   * `/canvas` hub 的其余四屏仍是 mock 原型（后端零路由，缺口已报 coord）。
   * 逐条钉住，而不是假装已清理：新增一条会红，清理一条也会红。
   */
  it("如实钉住：/canvas hub 上剩余的 mock 边正好是这几条（后端无对应路由）", () => {
    const { mockEdges, visited } = walk("app/canvas/page.tsx");
    expect(visited).toContain("components/canvas/canvas-hub.tsx"); // 反空转：真的走进了 hub
    expect(mockEdges).toEqual([
      // UC-7.2 AI 起草留白：后端无 draftCanvas 路由
      "components/canvas/ai-draft-panel.tsx -> lib/mock/canvas.ts",
      // UC-7.3 协作编辑三栏：项目上下文仍是 mock（属别的 issue 的热点，本 issue 不动）
      "components/canvas/canvas-left-panel.tsx -> lib/mock/projects.ts",
      "components/canvas/canvas-right-panel.tsx -> lib/mock/projects.ts",
      "components/canvas/conflict-bar.tsx -> lib/mock/projects.ts",
      // UC-7.4 回流知识图谱：后端无 backflow 路由
      "components/canvas/knowledge-backflow.tsx -> lib/mock/canvas.ts",
      // UC-7.1 F102 环节绑定：后端无 bindTemplateToSegment 路由
      "components/canvas/segment-binding.tsx -> lib/mock/canvas.ts",
      // UC-7.1 F100 模板编辑器：**契约里根本没有创建/更新模板的操作**，见 lib/live-canvas.ts 文件头
      "components/canvas/template-editor.tsx -> lib/mock/canvas.ts",
    ]);
  });
});
