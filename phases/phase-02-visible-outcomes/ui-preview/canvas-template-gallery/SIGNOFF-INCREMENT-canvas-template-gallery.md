---
status: pending
signoff_gate: contract-bundle canvas-visualization · 第 ① 件 UI（增量）
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# ① UI 签核**增量** —— 新建画布 → 选模板入口（20 个可视化模板 + mindmap 起点）

> ⚠ **status: pending —— 等人类签核，agent 不许改成 confirmed。**
> 交 coord-main「按备妥材料先行」，人类过目后补签。
> 支撑材料（逐条设计取舍、七态映射、testid、已知局限）见同目录 `design-note.md` 与 `README.md`——
> 本文件是**增量框**，不重复其内容。

## 变更点（人类原话起，2026-08-14）
「在后台的 template 需要列出常见的所有的可视化模板，包括用户画像、用户旅程图等，参考
`projects/fabric-markdown`；同时 mindmap 需要可以支持回车/tab 新增，也参考项目——这些在那个项目都实现了，
需要把代码迁移过来。」

**关键事实**：代码**已 100% 迁移**（19 个工作坊模板 + `mindmap-editor` 的 Tab/Enter 全部就绪、逐字一致），
缺的是**入口**——零处产品 UI 引用它们。本增量只补「新建画布 → 选一个模板起手」这个入口的 UI，
不改 `packages/fabric-markdown` 本体、不新建后端写路径。

## 第一版口径（原型默认，逐条待人类拍板 —— 详见 design-note）
- 交互形态 = **模态**「新建画布」（与既有 `template-apply-dialog` 一致）。
- 入口落点 = 项目画布页（现状永远从硬编码「谁在买储能」示例起手 → 换成「可选起点」）。**本轮不真改 `canvas-main.tsx`**。
- 起点 = **21 个**：19 个注册工作坊模板 + 思维导图起点 + 空白画布起点，按**四类**分组
  （用户研究 / 战略分析 / 叙事沟通 / 从空白起手 —— 分类是原型新造的展示事实，注册表无此字段）。
- 缩略 = 单字形图标占位（不渲染完整画布缩略图）。
- 「示例内容」开关（默认开）：只有 persona / journey-map 备了拟真种子（与「谁在买储能」同场景）。
- 选中 → **真实 `CanvasStage`** 用 `starterMarkdownFor(key)` 渲染出模板框架（链路打通的证据）。
- 七态全覆盖（既有原型零异常态，这里刻意补齐）；R5 四角色视角切换（观察者进 denied 态）。

## 截图（本目录）
| 文件 | 场景 |
|---|---|
| `CTG-gallery-default.png` | 默认：21 起点 · 四类分组 |
| `CTG-gallery-loading.png` | 加载 skeleton |
| `CTG-gallery-empty.png` | 搜索/筛选无结果 |
| `CTG-gallery-invalid.png` | 空白快建未起名 → `err-name` |
| `CTG-gallery-dep-failed.png` | 模板引擎加载失败 → 诚实错误框 + 重试 |
| `CTG-gallery-denied.png` | 观察者视角无法新建 |
| `CTG-success-persona-canvas.png` | 选「用户画像」→ 真实画布起手（含拟真示例）|
| `CTG-gallery-filter-user.png` | 分类过滤到「用户研究」 |
| `CTG-success-journey-canvas.png` | 选「用户旅程图」→ 真实画布起手 |
| `CTG-success-mindmap-canvas.png` | 选「思维导图」起点 → 真实 mindmap（Tab/Enter 编辑落点）|

无鉴权预览路由：`/preview/canvas-template-gallery?state=<态>&as=<角色>`（mock，不接后端）。

## 活实现与证据（非 mock 的部分）
- 新增（纯前端）：`apps/web/components/canvas/canvas-template-gallery.tsx`（画廊 + 七态 + 视角）、
  `apps/web/lib/mock/canvas-templates.ts`（画廊目录 mock：分类/blurb/图标 + `starterMarkdownFor`）、
  `apps/web/app/preview/canvas-template-gallery/page.tsx`（预览入口）。
- **复用真实组件**：`components/canvas/canvas-stage.tsx`（真实 fabric+mermaid 画布本体）、
  `@repo/fabric-markdown` 的 `getTemplate/listTemplates/templateToModel`（模板注册表 = 单一事实源，未复制）。
- 取证脚本：`apps/web/e2e/canvas-tpl-shots.spec.ts` + `playwright.tplgallery.config.ts`（对预热 server 出上述 10 图，10/10 passed）。
- **未做的**：不改后端、不新建「选了哪个模板」写路径、不改 `packages/fabric-markdown` 本体、不真改 `canvas-main.tsx` 接线。

## 建议人类签核时重点核对 3 处
1. **入口落点与交互形态**：模态 vs 独立页 vs 常驻侧栏——决定后续 worker 接线位置。
2. **分类与 blurb 文案**：四类归属 + 每张卡一句话，是原型新造、不在任何契约里的展示事实，最需人拍板。
3. **成功态是否可信**：`CTG-success-*` 三张确是**真实 CanvasStage** 渲染（persona 表头+便签 / journey 阶段 / mindmap 树），
   不是静态图——这条「选模板 → 画布真起手」是本原型的核心主张。

## 已知局限（不阻塞签核，详见 design-note）
1. 卡片标题双语不一致（HMW/PESTEL/SWOT/MVP/AI… 取不到中文头，回退全双语）——修法涉及是否加纯中文短名列，留签核定夺。
2. 未接后端写路径；示例内容仅 2 个模板；模态在预览页平铺（未做遮罩/ESC/焦点陷阱，真实接入需补无障碍）。
