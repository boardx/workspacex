# 契约束 `design-ai-collab` — 签核第 ① 件：UI

> ## 自检（可机械核对）
>
> **本文件引用 2 张截图，目录下实际 2 张。N == M，无死链、无多列、无遗漏。**
>
> 这一行由 `.harness/scripts/lint-ui-material.mjs` 双向对账（引用集合 == 实存集合），
> 不是一句自述——写错了会红。

## 本束不新增屏；这两张是从哪来的

UC-17.8 B5 只改两块**既有**对话面板里「AI 说的话从哪来」（固定回执 → 模型生成，失败退回
固定回执并如实标记），布局、testid、七态全部不变。两块面板分属两个不同的材料目录：

| 屏 | 组件 | 原图所在目录 | 本目录的副本 |
|---|---|---|---|
| 草稿「继续完善」浮层 | `components/design-loop/drafts-screen.tsx` `RefineOverlay` | `ui-preview/feedback-design-loop/`（UC-17.8 取材目录，未登记为束目录） | [drafts-refine-light.png](../../ui-preview/design-ai-collab/drafts-refine-light.png) |
| 设计详情（左栏「设计协作」对话） | `components/design-loop/detail-screen.tsx` | `ui-preview/design-workbench/`（`design-workbench` 束） | [detail-canvas-dark.png](../../ui-preview/design-ai-collab/detail-canvas-dark.png) |

**为什么是复制而不是 `reuse_bundle`**：`reuse_bundle` 只能指向**一个**同 phase 束，且要求
本文件引用集合与目标目录**完全相等**——B5 涉及的两屏一张在 `design-workbench`（16 张，其中
15 张与本束无关），一张在未登记为束的取材目录里，两个条件都不满足。按 phase-10 的先例
（`ui-material-map.json` 该 phase 的 `//` 注释：共用的图**复制**进各自目录各持一份），
把这两张复制进本束独占目录 `ui-preview/design-ai-collab/`；原图不删、不改。

⚠ 图与生产的差别**只有数据，没有代码**（同 `design-workbench` 束 `ui.md` 的纪律）：两张都
由 `apps/web/scripts/shot-feedback-design-loop.mjs` 渲染生产同一份组件、`page.route()`
拦截固定夹具拍出。截图里气泡的文字是 D7 固定回执版本——B5 之后同一屏同一位置显示的是
模型生成的文字，**屏的判断（布局/态/入口）不因此改变**。

## 与 B5 直接相关的两处新增视觉元素（未重拍）

- ⚠ 未产出：草稿浮层 AI 气泡内「固定回执」小标识（`draft-refine-turn-fallback`，10px、
  `text-muted-foreground`、`border-border`）——只在 `source: "fallback"` 时出现。
- ⚠ 未产出：设计详情 AI 气泡下方「已更新：验收标准 / 背景 / 画布页」行内提示与「固定回执」
  标识（B5.2）。

两处都是一行 token 化的辅助文字，不引入新控件、不改变七态；签核时若要看到实际渲染，
按 `design-workbench` 束 `ui.md` 的重跑命令加 `SHOTS_FILTER='^(drafts-refine|detail-canvas)'`
重拍并替换本目录两张即可（脚本夹具需先给 `chat[]` 里的 AI 记录加 `source`）。
