/**
 * 迭代 12 —— 把原型渲染成静态 HTML 片段，**复用实时画布那批组件**。
 *
 * 这一层只有一件事：`renderToStaticMarkup(<PrototypeCanvas …>)`。之所以单独一个文件，
 * 是为了让 `react-dom/server` 的动态 import 只在点导出时才发生（它不该进主 bundle），
 * 同时给导出菜单一个可以在测试里替换掉的窄接口。
 *
 * ⚠ 这里**不许**出现任何"画一个按钮长什么样"的知识。导出与实时画布的结构必须来自
 *   同一处渲染表（verification.md V47 用"同一棵树两边的 class 集合一致"钉住），
 *   否则每加一个原语就要改两处、且没有门控挡漂移。
 */
import * as React from "react";
import { PrototypeCanvas, deviceOf } from "@/components/design-loop/prototype-canvas";
import type { DesignProject } from "@/lib/live-design-workbench";

export async function renderScreensToMarkup(
  project: Pick<DesignProject, "frames" | "prototype" | "template"> & { readonly frameLinks?: readonly (readonly { from: string; item?: number; to: number }[])[] },
): Promise<readonly { readonly markup: string }[]> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const device = deviceOf(project.template);
  return project.frames.map((label, i) => ({
    markup: renderToStaticMarkup(
      React.createElement(PrototypeCanvas, {
        label,
        root: project.prototype[i] ?? null,
        device,
        frameIndex: i,
        // 导出产物里没有"选中去改"这回事：用预览语义渲染，且不接任何回调。
        mode: "preview" as const,
        links: project.frameLinks?.[i] ?? [],
      }),
    ),
  }));
}
