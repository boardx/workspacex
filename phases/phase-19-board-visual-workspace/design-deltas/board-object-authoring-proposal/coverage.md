# 契约束 `board-object-authoring` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/02-object-authoring.md`，并引用
> `requirements/05-collaboration-history.md` 的基础 Undo 成功时序。本束覆盖 BV04–BV06；
> 表中命令是 feature_list 已冻结的未来验证入口，不代表测试或实现今天存在。

## 一、feature / R12 → operation → 门控命令 → 前端消费点

| R12 行键 | feature / 验收线索 | operation / 断言面 | 门控命令 | 前端消费点 | 状态 |
|---|---|---|---|---|---|
| V1 | BV04 · Sticky/Text 创建后立即输入；shape/style/三 resize mode 可编辑 | `createSticky`、`createText`、`updateObjectPresentation` | `pnpm --filter web exec vitest run tests/ui/board-sticky-text-editing.test.tsx tests/ui/board-sticky-resize-modes.test.ts` | `board-inline-editor-*`、`board-sticky-resize-mode` | 契约闭合；实现待建 |
| V2 | BV04 · IME、RTL、长文本不误提交 | `commitTextEdit`；composition 期间 0 splice | `pnpm --filter web exec playwright test -c playwright.config.ts -g 'sticky text IME'` | `board-inline-editor-composing`、announcer | 契约闭合；真实输入法证据待建 |
| V3 | BV05 · TTFI `<5s`；第一张后再建 10 张 `<30s` | `createSticky`、`continueStickySeries`；trace 时间与动作计数 | `pnpm --filter web exec playwright test -c playwright.config.ts -g 'TTFI <5s'`<br>`pnpm --filter web exec playwright test -c playwright.config.ts -g '10 stickies <30s'` | `board-authoring-trace`、`board-sticky-*` | 契约闭合；真实浏览器 trace 待建 |
| V4 | BV05 · create/edit/delete/basic undo/redo；Delete Undo 同 id | `deleteBoardObjects`、`undoBoardAuthoring`、`redoBoardAuthoring` | `pnpm --filter web exec playwright test -c playwright.config.ts -g 'basic create edit delete undo redo'` | `board-object-delete-status`、undo/redo、DOM mirror | 契约闭合；causal conflict fixture 待建 |
| V5 | BV05 · 多行输入最多 500 张且一次原子 transaction | `bulkCreateStickies` | `pnpm --filter web exec vitest run tests/ui/board-sticky-quick-capture.test.tsx tests/ui/board-bulk-sticky-transaction.test.ts` | Paste Intelligence 轻量选择、创建结果 | 契约闭合；实现待建 |
| V6 | BV06 · Sticky 属性、Reaction、Link Preview 与 readonly | `updateObjectPresentation`、`setObjectReaction`、`setObjectLink/resolveLinkPreview` | `pnpm --filter web exec vitest run tests/ui/board-sticky-contextual-toolbar.test.tsx tests/ui/board-reaction-link-preview.test.tsx` | contextual toolbar、reaction menu、link preview | 契约闭合；ACL/SSRF fixture 待建 |
| V7 | BV06 · 真实浏览器完成 reaction/link ready 与失败降级 | 同 V6；revision/blocked/timeout 反证 | `pnpm --filter web exec playwright test -c playwright.config.ts -g 'sticky properties reaction link preview'` | `board-object-link-preview` 四态、announcer | 契约闭合；状态截图/E2E 待建 |

## 二、主流程与异常流程覆盖

| requirement | 行为 / 失败 | operation | 观察点 / 反证 |
|---|---|---|---|
| R2/R3.1 | 双击、工具、`N` 创建并直接输入 | `createSticky` | 无菜单；canonical id 投影后 caret-ready |
| R3.1/R4 A1 | Tab 24px 横向/纵向连续创建 | `continueStickySeries` | 10 次 Tab/10 个新 id；不同 zoom geometry 一致 |
| R3.2/R9 | shape、颜色、字号、normal/free/autoHeight、IME/RTL/长文本 | `commitTextEdit`、`updateObjectPresentation` | composition 0 半提交；模式 round-trip |
| R3.3 | Text 五层级与直接编辑 | `createText`、`commitTextEdit` | level/style 均为 canonical，Fabric 可丢弃重建 |
| R3.6/R4 A2/R7 | 多行 Paste 与 500 Sticky 原子创建 | `bulkCreateStickies` | 整批 1 transaction/1 history；超限 0 落地 |
| R3.7/R4 E3 | 删除、同 id Undo；编辑中远端删除 | `deleteBoardObjects`、history operations | tombstone 后才消失；draft 不复活对象 |
| R3.8/R8 | Reaction、Link Preview、contextual toolbar | `setObjectReaction`、link operations | summary 可重建；link failure 保留 URL |
| R4 E4/R9 | HTML/script/危险 URL 与恶意预览 | `setObjectLink`、resolver port | scheme/SSRF/content 白名单；Board 无原始 HTML |
| R5 | Viewer/Commenter 不可对象写入 | 所有 mutation | 工具、快捷键、adapter 三入口 update=0 |
| Collaboration R3/R7 | 成功提示晚于确认；Undo 不覆盖他人写入 | history operations | 延迟 observer/foreign revision 失败注入 |

## 三、operation → 需求（反向检查）

| operation | 被哪条需求 / feature 要求 | 是否孤儿 |
|---|---|---|
| `createSticky` | R2、R3.1、R12、BV04/BV05 | 否 |
| `createText` | R3.3、BV04 | 否 |
| `commitTextEdit` | R3.1–R3.3、R4 E3、R9、BV04 | 否 |
| `continueStickySeries` | R3.1、R4 A1、R12、BV05 | 否 |
| `bulkCreateStickies` | R3.6、R4 A2、R7、R12、BV05 | 否 |
| `updateObjectPresentation` | R3.2/R3.3、R8、BV04/BV06 | 否 |
| `setObjectReaction` | R3.8、R8、BV06 | 否 |
| `setObjectLink/resolveLinkPreview` | R3.8、R4 E4、R8/R9、BV06 | 否 |
| `deleteBoardObjects` | R3.7、R4 E3、R12、BV05 | 否 |
| `undoBoardAuthoring/redoBoardAuthoring` | R3.7、collaboration R3/R7、BV05 | 否 |

## 四、当前证据与材料边界

- 已有：S01 已签核的 Fabric surface/selection/command 边界；BV04–BV06 的权威行为与验证命令。
- 尚无：本束 UI 截图、inline editor、真实 IME、严格体验 trace、bulk transaction、history conflict、
  Reaction ACL、Link Preview 安全 resolver 与失败 fixture。
- 因此本矩阵只证明设计覆盖闭合；它不能让 BV04–BV06 进入 claim，也不能把本束改为 confirmed。
