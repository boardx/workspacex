/**
 * canvas hub 的**屏注册表**（`/canvas?screen=…`）。
 *
 * ## 为什么它从 `lib/mock/canvas.ts` 搬到了这里（#464）
 *
 * 它不是数据，是**路由导航**：把 URL 上的一个字符串收敛成一个已知的屏 id。
 * 留在 `lib/mock/` 下会让「这条路由不吃 mock」这件事永远无法机械断言——
 * 而真正吃 mock 的是各屏内部的数据，不是这张表。搬出来之后两者可以分别说话。
 *
 * ⚠ 搬，不是复制。`lib/mock/canvas.ts` 里那一份已经删除，
 * 由 `tests/session/canvas-template-routes-no-mock.test.ts` 钉住不许再长回去。
 */

export type CanvasScreen =
  | "template-admin" // UC-7.1 后台画布模板库（#464 起接真实 API）
  | "template-editor" // UC-7.1 模板编辑器（后端零路由，仍是原型）
  | "segment-binding" // UC-7.1 议程环节绑定模板与 skill（后端零路由，仍是原型）
  | "editor" // UC-7.3 组内协作编辑画布（后端零路由，仍是原型）
  | "ai-draft" // UC-7.2 AI 起草留白规则（后端零路由，仍是原型）
  | "backflow"; // UC-7.4 画布回流知识图谱（后端零路由，仍是原型）

export const CANVAS_SCREENS: { id: CanvasScreen; label: string; uc: string }[] = [
  { id: "template-admin", label: "画布模板库", uc: "UC-7.1 · F101" },
  { id: "template-editor", label: "模板编辑器", uc: "UC-7.1 · F100/F101" },
  { id: "segment-binding", label: "环节绑定", uc: "UC-7.1 · F102" },
  { id: "editor", label: "画布编辑器", uc: "UC-7.3 · F103-105" },
  { id: "ai-draft", label: "AI 起草留白", uc: "UC-7.2 · F106" },
  { id: "backflow", label: "回流知识图谱", uc: "UC-7.4 · F107" },
];

export function resolveCanvasScreen(raw: string | string[] | undefined): CanvasScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return CANVAS_SCREENS.some((s) => s.id === v) ? (v as CanvasScreen) : "template-admin";
}
