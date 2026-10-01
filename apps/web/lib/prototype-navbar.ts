import { designPrototype } from "@repo/contracts";

/**
 * 导航栏左右两侧（`navbar.left` / `navbar.right`）该画成什么——画布与 React 导出共用这一处。
 *
 * 真实模型生成的 79 页里，左右两侧有 23 次写的是**图标名**（back / search / bell / plus / home / filter……），
 * 而渲染器一律当文字印出来：用户看到导航栏上一个英文「back」、一个「search」（2026-09-27 实测截图）。
 * 值恰好是图标清单里的名字 ⇒ 画图标（读屏名给中文）；否则照旧是文字（「返回」「保存」这种本来就该是字）。
 */
export type NavbarSide = { readonly icon: designPrototype.PrototypeIcon; readonly label: string } | { readonly text: string };

const LABEL: Partial<Record<designPrototype.PrototypeIcon, string>> = {
  back: "返回", forward: "前进", search: "搜索", bell: "通知", plus: "新增", home: "首页", filter: "筛选",
  menu: "菜单", more: "更多", settings: "设置", share: "分享", user: "我的", message: "消息", send: "发送",
};

export function navbarSide(value: string | undefined): NavbarSide | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = designPrototype.PrototypeIcon.safeParse(value.trim());
  if (parsed.success) return { icon: parsed.data, label: LABEL[parsed.data] ?? value.trim() };
  return { text: value };
}
