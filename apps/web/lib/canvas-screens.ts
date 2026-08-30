/**
 * canvas hub 的**屏注册表**（`/canvas/[screen]` 路径段）。
 *
 * ## 为什么它从 `lib/mock/canvas.ts` 搬到了这里（#464）
 *
 * 它不是数据，是**路由导航**：把 URL 上的一个字符串收敛成一个已知的屏 id。
 * 留在 `lib/mock/` 下会让「这条路由不吃 mock」这件事永远无法机械断言——
 * 而真正吃 mock 的是各屏内部的数据，不是这张表。搬出来之后两者可以分别说话。
 *
 * ⚠ 搬，不是复制。`lib/mock/canvas.ts` 里那一份已经删除，
 * 由 `tests/session/canvas-template-routes-no-mock.test.ts` 钉住不许再长回去。
 *
 * ⚠ 2026-08-30（画布模板后台管理刷新掉回根目录一案的路由复盘）：屏切换此前靠
 * `?screen=` 查询参数，六个屏因此共享同一个路径 `/canvas`——Next.js App Router
 * 的推荐做法是「不同视图 = 不同路径段」，query 只该表达同一视图内的正交状态
 * （筛选/搜索/视角/预览态），不该表达「现在是哪个页面」。现在规范落点是
 * `/canvas/[screen]/page.tsx`；裸 `/canvas?screen=…` 仍可用，只是历史书签的
 * 兼容重定向层（`app/canvas/page.tsx`），不再是权威路由形态。
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

/** 类型守卫：路径段必须**精确**是六个已知屏之一，不认识就该 404，不该悄悄回落。 */
export function isCanvasScreen(v: string): v is CanvasScreen {
  return CANVAS_SCREENS.some((s) => s.id === v);
}

/**
 * 宽松解析——只给**历史 `?screen=` 兼容重定向层**（`app/canvas/page.tsx`）用：
 * 无法识别的值一律回落到默认屏，而不是 404，因为它面对的是可能过期/拼错的外部书签，
 * 目标是「至少给个能用的页面」而不是拒绝服务。`/canvas/[screen]/page.tsx` 本体
 * 不用这个——那里认不出屏就该 `notFound()`，见 `isCanvasScreen`。
 */
export function resolveCanvasScreen(raw: string | string[] | undefined): CanvasScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v !== undefined && isCanvasScreen(v) ? v : "template-admin";
}
