/**
 * 对标 R10（#3955）—— 导出的 .tsx 要**真的能用**：不是看字符串里有没有某个词，而是用 TypeScript
 * 把它转译成 JS、在测试里加载、用 React 渲染出来，再点它的跳转。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { designPrototype, designWorkbench } from "@repo/contracts";
import { buildPrototypeReactTsx, prototypeReactFileName, svgToJsx } from "@/lib/prototype-react-export";
import { iconSvgs, usedIcons } from "@/lib/prototype-react-export-icons";

afterEach(cleanup);

type N = designPrototype.PrototypeNode;
/** 每种原语至少出现一次（见最后那条「闭集全覆盖」断言）。 */
const kitchenSink: N = {
  id: "root", type: "stack", props: { direction: "column", gap: "md" }, children: [
    { id: "nav", type: "navbar", props: { title: "会员", left: "‹" } },
    { type: "text", props: { content: "标题里有 {花括号} 和 <尖括号>", variant: "title" } },
    { id: "buy", type: "button", props: { label: "发送", variant: "primary" } },
    { type: "input", props: { label: "昵称", placeholder: "输入昵称" } },
    { type: "image", props: { alt: "封面图" } },
    { id: "list", type: "list", props: { items: ["第一项", "第二项"], detail: ["说明一", ""], trailing: ["¥9", ""] } },
    { type: "divider" },
    { type: "spacer", props: { size: "sm" } },
    { id: "tabs", type: "tabs", props: { items: ["详情", "规格"] } },
    { type: "badge", props: { label: "新", tone: "success" } },
    { type: "avatar", props: { name: "张三" } },
    { type: "switch", props: { label: "自动续费", on: true } },
    { type: "checkbox", props: { label: "同意协议" } },
    { type: "chip", props: { label: "热门", selected: true } },
    { type: "progress", props: { value: 40, label: "进度" } },
    { type: "stat", props: { label: "本周", value: "12 次", delta: "+3", tone: "success" } },
    { type: "hero", props: { title: "大标题", subtitle: "副标题", cta: "开始" } },
    { type: "card", props: { title: "卡片" }, children: [{ type: "text", props: { content: "卡片里" } }] },
    { type: "grid", props: { columns: 2 }, children: [{ type: "text", props: { content: "格一" } }, { type: "text", props: { content: "格二" } }] },
    { type: "table", props: { columns: ["月份", "销售额"], rows: [["一月", "100"], ["二月", "120"]], striped: true } },
    { type: "chart", props: { kind: "bar", title: "柱状", labels: ["一", "二"], values: [3, 5] } },
    { type: "chart", props: { kind: "line", title: "折线", labels: ["一", "二", "三"], values: [1, 4, 2] } },
    { type: "select", props: { label: "城市", options: ["北京", "上海"], value: "上海" } },
    { type: "radio", props: { label: "档位", options: ["月付", "年付"], selected: 1 } },
    { type: "section", props: { tone: "primary", align: "center" }, children: [{ type: "text", props: { content: "分区" } }] },
    { type: "footer", props: { brand: "品牌", links: ["关于"], note: "© 2026" } },
    { type: "overlay", props: { kind: "modal", title: "确认注销" }, children: [{ type: "text", props: { content: "弹窗里" } }] },
    { id: "bn", type: "bottomnav", props: { items: ["首页", "历史"] } },
  ],
};

const project = {
  name: "聊天 App", frames: ["对话", "历史", "设置"],
  prototype: [kitchenSink, { type: "stack", children: [{ type: "text", props: { content: "历史会话页" } }] } as N, null],
  frameLinks: [[{ from: "buy", to: 2 }, { from: "bn", item: 1, to: 1 }, { from: "tabs", item: 1, to: 1 }], [], []],
  accent: "neutral" as const, tokens: { ...designWorkbench.DEFAULT_DESIGN_TOKENS, brand: "#FF5A1F", font: "serif" as const }, theme: "light" as const,
};

/** 转译 + 加载：语法错、类型擦除后跑不起来的代码都会在这里炸。 */
function load(tsx: string): React.ComponentType {
  const out = ts.transpileModule(tsx, {
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  expect(out.diagnostics ?? []).toEqual([]);
  const mod: { exports: { default?: React.ComponentType } } = { exports: {} };
  const req = (id: string) => (id === "react" ? React : id === "react/jsx-runtime" ? jsxRuntime : (() => { throw new Error(`unexpected import ${id}`); })());
  new Function("require", "module", "exports", out.outputText)(req, mod, mod.exports);
  if (mod.exports.default === undefined) throw new Error("no default export");
  return mod.exports.default;
}

describe("buildPrototypeReactTsx", () => {
  const tsx = buildPrototypeReactTsx(project, { now: new Date(2026, 8, 23) });

  it("一个文件、只 import react、默认导出一个组件；品牌色与字体进 THEME", () => {
    expect(tsx).toMatch(/export default function Prototype\(\)/);
    expect([...tsx.matchAll(/^import\b[^"]*"([^"]+)";$/gm)].map((m) => m[1])).toEqual(["react"]);
    expect(tsx).toContain(`"--primary": ${JSON.stringify(designWorkbench.brandAccentTokens("#FF5A1F").primary)}`);
    expect(tsx).toContain("Noto Serif SC");
  });

  it("转译后真的能渲染：每种原语的文字都在，文案里的花括号尖括号原样显示", () => {
    const Prototype = load(tsx);
    render(<Prototype />);
    for (const t of ["发送", "标题里有 {花括号} 和 <尖括号>", "第一项", "说明一", "规格", "自动续费", "12 次", "大标题", "卡片里", "格二", "二月", "柱状", "折线", "年付", "分区", "© 2026", "确认注销", "历史"]) {
      expect(screen.getAllByText(t, { exact: false }).length, t).toBeGreaterThan(0);
    }
    expect(screen.getByPlaceholderText("输入昵称")).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("上海");
  });

  it("原型里连好的跳转在代码里也能走：整个节点、tabs 的某一项、底部导航的某一项；没画出来的页如实说", () => {
    const Prototype = load(tsx);
    render(<Prototype />);
    fireEvent.click(screen.getByText("发送"));
    expect(screen.getByText("「设置」这一页还没画出来")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    fireEvent.click(screen.getByRole("tab", { name: "规格" }));
    expect(screen.getByText("历史会话页")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "对话" }));
    fireEvent.click(within(screen.getByRole("navigation", { name: "底部导航" })).getByText("历史"));
    expect(screen.getByText("历史会话页")).toBeTruthy();
  });

  it("深度 S4：导出的代码点得动——tabs 切换选中、底部导航当前项跟着变、chip 能切换", () => {
    // 这一页的 tabs / 底部导航不连别的页：点下去只换「当前项」，看得出是真状态而不是换了页。
    const one = {
      ...project, frames: ["详情"], frameLinks: [[]],
      prototype: [{ type: "stack", children: [
        { id: "t", type: "tabs", props: { items: ["详情", "规格", "评价"], active: 0 } },
        { type: "chip", props: { label: "热门", selected: true } },
        { id: "bn", type: "bottomnav", props: { items: ["首页", "我的"], active: 0 } },
      ] } as N],
    };
    render(React.createElement(load(buildPrototypeReactTsx(one))));
    fireEvent.click(screen.getByRole("tab", { name: "规格" }));
    expect(screen.getByRole("tab", { name: "规格" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "详情" }).getAttribute("aria-selected")).toBe("false");
    const nav = within(screen.getByRole("navigation", { name: "底部导航" }));
    expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(nav.getByRole("button", { name: "我的" }));
    expect(nav.getByRole("button", { name: "我的" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("button", { name: "首页" }).getAttribute("aria-current")).toBeNull();
    const chip = screen.getByRole("button", { name: "热门" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("深度 S5：导出的代码带图标——按钮、底部导航（含按标签猜的）、图标列表，都是内联 SVG，仍只 import react", async () => {
    const one = {
      ...project, frames: ["首页"], frameLinks: [[]],
      prototype: [{ type: "stack", children: [
        { type: "button", props: { label: "分享周报", icon: "share" } },
        { type: "list", props: { items: ["个人资料", "账号安全"], leading: "icon", icons: ["user", "lock"] } },
        { type: "bottomnav", props: { items: ["首页", "我的"] } },
      ] } as N],
    };
    const icons = await iconSvgs(one.prototype);
    expect(Object.keys(icons).sort()).toEqual([...usedIcons(one.prototype)].sort());
    const tsx = buildPrototypeReactTsx(one, { icons });
    expect([...tsx.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1])).toEqual(["react"]);
    expect(tsx).not.toContain("class=");
    const { container } = render(React.createElement(load(tsx)));
    expect(screen.getByRole("button", { name: "分享周报" }).querySelectorAll("svg")).toHaveLength(1);
    for (const row of ["个人资料", "账号安全"]) expect(screen.getByText(row).closest("li")!.querySelectorAll("svg")).toHaveLength(1);
    expect(within(screen.getByRole("navigation", { name: "底部导航" })).getAllByRole("button").map((b) => b.querySelectorAll("svg").length)).toEqual([1, 1]);
    expect(container.querySelectorAll("svg[stroke-width]").length).toBeGreaterThan(0);
    // 不给图标表 ⇒ 与 S4 一样没有图标，不出错。
    render(React.createElement(load(buildPrototypeReactTsx(one))));
    expect(screen.getAllByRole("button", { name: "分享周报" })[1]!.querySelectorAll("svg")).toHaveLength(0);
  });

  it("深度 S5：SVG 转 JSX 只认图标元素——白名单外的标签整个不要", () => {
    expect(svgToJsx('<svg class="lucide" stroke-width="2" aria-hidden="true"><path d="M1 1"></path></svg>')).toBe('<svg strokeWidth="2" aria-hidden="true"><path d="M1 1"></path></svg>');
    expect(svgToJsx('<svg><script>alert(1)</script></svg>')).toBeNull();
    expect(svgToJsx('<div><svg></svg></div>')).toBeNull();
  });

  it("闭集全覆盖：契约里每种原语都在上面的样例里出现过（新增原语 ⇒ 这里提醒补样例）", () => {
    const seen = new Set<string>();
    const walk = (n: N) => { seen.add(n.type); if (designPrototype.isPrototypeContainer(n)) n.children.forEach(walk); };
    walk(kitchenSink);
    expect([...designPrototype.PrototypeNodeType.options].filter((t) => !seen.has(t))).toEqual([]);
  });

  it("文件名是 ASCII 的 .tsx（中文名会让浏览器把下载名丢成 download）", () => {
    expect(prototypeReactFileName("聊天 App", new Date(2026, 8, 23))).toMatch(/^[\x20-\x7e]+-prototype-2026-09-23\.tsx$/);
  });
});
