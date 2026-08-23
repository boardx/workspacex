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
    // `createTemplate` 是 #496 补上的第六个，`mintTemplateVersion` 是 #988 补上的第七个
    // （两者均已由人类签核，见 `design-signoff.md`）。
    for (const op of [
      "createTemplate", "listTemplates", "publishTemplate", "trialTemplate",
      "archiveTemplate", "restoreTemplate", "mintTemplateVersion",
    ]) {
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
      // D-43 被推翻（2026-08-17）：template-admin 屏重新挂上 `AdminNav`（后台侧栏），
      // 与后台所有其它模块共用同一份左栏——这三条边是 `AdminNav` 自身的既有形态，不是
      // 本次新引入的债：`lib/mock/admin.ts` 是 `ADMIN_NAV` 导航结构（菜单项/图标/顺序）
      // 的单一事实源，`asset-kind-nav.ts` 派生自它，`live-admin-nav-counts.ts` 兜底无
      // 会话时的静态计数——这三条边在其它任何一个挂了 `AdminNav` 的后台屏（`/admin/
      // [module]`）的依赖树里同样存在，canvas hub 只是第一次把它们变得对这份走图器
      // 可见。
      "components/admin/admin-nav.tsx -> lib/mock/admin.ts",
      "components/admin/asset-kind-nav.ts -> lib/mock/admin.ts",
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
      // UC-7.1 F100 模板编辑器：C_CANVAS_8 ②「开新版」已由 #988 的 `mintTemplateVersion`
      // 补上（真实端点在 template-admin 那一屏的「基于此开新版」按钮，见上面第二条断言：
      // 那棵树里零 mock 边）。这一屏（template-editor）要的是**签核材料第二节**那部分——
      // mermaid 图分支的设计对话、分区重排、版本历史与回滚——人类签核时明确裁定该扩展
      // 「作为后续独立 feature 迭代」，不在 #988 范围内，所以仍是 mock 原型。
      "components/canvas/template-editor.tsx -> lib/mock/canvas.ts",
      "lib/live-admin-nav-counts.ts -> lib/mock/admin.ts",
    ]);
  });

  /**
   * 🟡 #496：新建这条**写**路径必须真的落在契约声明的端点上。
   *
   * ⚠ 与「没有 mock 边」是两件事：一个屏可以既不引 `lib/mock`，又把创建请求打到一个
   *   手抄的字面量路径上——那正是 issue 明令禁止的「造出第二个事实源」。
   */
  it("#496 新建走的是契约声明的 createTemplate 端点，且全仓只有一个出口", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-canvas.ts"), "utf8");
    expect(client).toContain("canvas.operations.createTemplate.path");

    const callers = walk(TEMPLATE_ADMIN).visited
      .filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("createTemplate.path"));
    expect(callers).toEqual(["lib/live-canvas.ts"]);

    // 模板库屏确实调到了那个出口——否则上面两条可能只是在描述一个没人用的函数。
    const admin = readFileSync(resolve(ROOT, TEMPLATE_ADMIN), "utf8");
    expect(admin).toContain("createCanvasTemplate(");
  });

  /**
   * 🟢 #988：「基于此开新版」——本束「编辑」的真实入口——同样必须落在契约声明的端点上。
   * 与「没有 mock 边」是两件事，理由同上一条。
   */
  it("#988 基于此开新版走的是契约声明的 mintTemplateVersion 端点，且全仓只有一个出口", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-canvas.ts"), "utf8");
    // 走的是 `templatePath(canvas.operations.mintTemplateVersion, ...)`，同 publish/trial/
    // archive/restore 那几条共用的路径拼接器，不是一个独立的 `.path` 字面量引用。
    expect(client).toContain("canvas.operations.mintTemplateVersion");

    const callers = walk(TEMPLATE_ADMIN).visited
      .filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("mintTemplateVersion"));
    expect(callers).toEqual(["lib/live-canvas.ts"]);

    const admin = readFileSync(resolve(ROOT, TEMPLATE_ADMIN), "utf8");
    expect(admin).toContain("mintCanvasTemplateVersion(");
  });

  /**
   * 🟢 #493：「**使用**一个模板」这条写路径同样必须落在契约声明的端点上，出口唯一。
   *
   * ⚠ 与「没有 mock 边」是两件事：一个屏可以既不引 `lib/mock`，又把绑定请求打到一个手抄的
   *   `/canvas/agenda-segments/...` 字面量上——那正是本仓禁止的「第二个事实源」。手抄那一半
   *   已被上面「整份 live-canvas 里不许出现 /canvas/ 字面量」挡住，这里补正向的一半。
   */
  it("#493 使用模板走契约声明的 bindTemplateToSegment 端点，且模板库屏真的调到了它", () => {
    const client = readFileSync(resolve(ROOT, "lib/live-canvas.ts"), "utf8");
    expect(client).toContain("canvas.operations.bindTemplateToSegment");

    const tree = walk(TEMPLATE_ADMIN);
    // 反空转：对话框必须真的在这棵树里，否则下面几条在描述一个没人渲染的组件。
    expect(tree.visited).toContain("components/canvas/template-apply-dialog.tsx");
    // ⚠ 判据是 `canvas.operations.bindTemplateToSegment` 而不是 `bindTemplateToSegment.path`：
    //   实现里是 `const op = canvas.operations.bindTemplateToSegment;` 再 `op.path.replace(...)`，
    //   按后者去数会命中 0 个文件 —— 一条恒红（改天有人「顺手修好」就变恒绿）的断言。
    const callers = tree.visited
      .filter((f) => readFileSync(resolve(ROOT, f), "utf8").includes("canvas.operations.bindTemplateToSegment"));
    expect(callers).toEqual(["lib/live-canvas.ts"]);
    // 而且路径确实是从契约对象上替换出来的，不是拼字符串。
    expect(client).toContain("op.path.replace(\":agendaSegmentId\"");

    const dialog = readFileSync(resolve(ROOT, "components/canvas/template-apply-dialog.tsx"), "utf8");
    expect(dialog).toContain("bindCanvasTemplateToSegment(");
    // 环节 id 来自 `GET /projects/:id/overview` 的真实响应，不是界面上一个输入框。
    expect(dialog).toContain("getProjectOverview(");
    expect(dialog).toContain("currentAgendaSegment");
  });

  /**
   * 🟢 #493：**绑定成功之后必须重新读一次列表**，不许在本地把 `usageCount` 加一。
   *
   * `usageCount` 是服务端 `COUNT(*) FROM canvas_template_bindings` 现查出来的，核心闭环
   * 第 8c 步靠它区分「写进了 PostgreSQL」与「写进了 React state」。前端自己加一，那条 e2e
   * 断言就会在绑定根本没落库时照样绿 —— 本仓九次「全绿但空转」的又一种形态。
   *
   * ⚠ 切的是 `applied` 这**一个函数的函数体**，不是「两个名字在文件里离得远不远」
   *   （理由与下面 #496 那条逐字相同）。
   */
  it("#493 使用成功后重新读列表：applied 的函数体里 await load()，且没碰 usageCount", () => {
    const admin = readFileSync(resolve(ROOT, TEMPLATE_ADMIN), "utf8");
    const body = functionBody(admin, "async function applied(");
    expect(body).toContain("await load()");
    expect(body).not.toContain("usageCount");

    // 正样本：同一台切割器切 `create` 时切得到它自己的创建调用 —— 证明它不是对任何输入
    // 都返回一段「刚好不含目标字符串」的文本。
    expect(functionBody(admin, "async function createMinimal(")).toContain("createCanvasTemplate(");
  });

  /**
   * 🟡 #496：**新建不许顺手发布**。服务端是两步（造一行 `draft` → `publishTemplate`），
   * 界面把它们合成一步，就是在前端把已签核的三段发布流程抹掉一段。
   *
   * ⚠ 断言取的是 `create` 这一个函数的**函数体**，不是「两个名字在文件里离得远不远」。
   *   后者会因为顶部的 import 把两个名字排在一起而恒红（第一版就是这么写的，它红了），
   *   而一个恒红/恒绿的正则正是本仓九次「全绿但空转」里最常见的那一种。
   */
  it("#496 新建不顺手发布：create 的函数体里没有 publishCanvasTemplate", () => {
    const admin = readFileSync(resolve(ROOT, TEMPLATE_ADMIN), "utf8");
    const body = functionBody(admin, "async function createMinimal(");
    // 反空转：切出来的必须真的是那个函数体（它里面必须有创建调用），否则下面那条恒绿。
    expect(body).toContain("createCanvasTemplate(");
    expect(body).not.toContain("publishCanvasTemplate");

    // 正样本：同一台切割器切 `publish` 时**必须**切到 publish 调用 ——
    // 证明它不是对任何输入都返回一段不含目标字符串的文本。
    const publishBody = functionBody(admin, "async function publish(");
    expect(publishBody).toContain("publishCanvasTemplate(");
  });
});

/** 从 `marker` 起按大括号配平切出一个函数体。切不出来就抛，不返回空串（空串会让断言恒绿）。 */
function functionBody(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${marker} —— 断言会空转`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`${marker} 之后没有 { —— 断言会空转`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`${marker} 的大括号没有配平 —— 断言会空转`);
}
