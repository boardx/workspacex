/**
 * 深度 S5（#3988）—— 导出代码里的**图标**：画布上按钮、底部导航、图标列表都有图标，导出的 .tsx 此前一个都没有。
 *
 * 图标长什么样只有一份事实：画布的 `ICONS`（契约 `PrototypeIcon` 闭集 → lucide 组件）与底部导航的
 * `guessNavIcon`。这里不另抄一张表，而是**用同一张表把图标渲染成 SVG**（`react-dom/server`，只在导出时
 * 动态加载，不进主包），交给生成器内联成 JSX——导出的文件因此仍然只依赖 react。
 */
import * as React from "react";
import type { designPrototype } from "@repo/contracts";
import { ICONS, guessNavIcon } from "@/components/design-loop/prototype-canvas";
import type { DesignProject } from "@/lib/live-design-workbench";

type Icon = designPrototype.PrototypeIcon;
type Node = designPrototype.PrototypeNode;

/** 这份原型用到的图标：按钮的 `icon`、列表的 `icons`（leading 为 icon 时）、底部导航的 `icons` 或按标签猜。 */
export function usedIcons(prototype: DesignProject["prototype"]): Icon[] {
  const out = new Set<Icon>();
  const walk = (n: Node): void => {
    if (n.type === "button" && n.props.icon !== undefined) out.add(n.props.icon);
    if (n.type === "list" && n.props.leading === "icon") for (const i of n.props.icons ?? []) out.add(i);
    if (n.type === "bottomnav") n.props.items.forEach((label, i) => { const ic = n.props.icons?.[i] ?? guessNavIcon(label); if (ic !== null) out.add(ic); });
    if ("children" in n) for (const c of n.children) walk(c);
  };
  for (const root of prototype) if (root !== null) walk(root);
  return [...out];
}

/** 把用到的图标渲染成 SVG 标记（与画布同一张表）。键是契约图标名。 */
export async function iconSvgs(prototype: DesignProject["prototype"]): Promise<Record<string, string>> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return Object.fromEntries(usedIcons(prototype).map((name) => [
    name, renderToStaticMarkup(React.createElement(ICONS[name], { "aria-hidden": true, width: 16, height: 16 })),
  ]));
}
