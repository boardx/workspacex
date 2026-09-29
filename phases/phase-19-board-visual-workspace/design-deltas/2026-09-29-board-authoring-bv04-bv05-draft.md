# BV04–BV05 Board authoring 设计材料草案

- 状态：**draft，待 UI 材料、契约束、一致性复核与人类签核**。本文件不是 `contracts/` 正式束，也不改变 feature 状态。
- 核对基线：隔离工作树当前 `origin/main` 检出点 `73f3d48740c2af5d75844633d1ef08ef7e10f260`。2026-09-29 查询 GitHub：#4524 仍为 `OPEN`、未合并，head `3c4a60cdbf55306794071ca8c3ae9bb5391e075e`，base `3d380bad4043f29c7c230befca3d22cbbfc54d16`。PR 状态和 diff 在实施前仍须再次核验。
- 权威输入：`../feature_list.json` BV04/BV05、`../requirements/02-object-authoring.md`、`../requirements/05-collaboration-history.md`、`../contracts/board-fabric-surface/` 和 `2026-09-26-library-bottom-dock.md`。

## ① UI：待制作和签核的真实状态

正式 `/studio/board/:boardId` 上，以底部 dock 创建 Sticky/Text，焦点直接进入画布行内编辑器。Sticky 选中后能看见形状（方/矩形/圆）、颜色、字号和尺寸模式；Text 能选标题/正文/标签层级。属性变化应落在对象本体，刷新及第二客户端仍一致。编辑态必须有可辨识焦点、取消/完成语义、连接状态；软键盘不得遮挡输入框或 dock。Viewer/Commenter 的创建、编辑、Delete 和快捷键均禁用，阅读与选择仍可用。

需要补的 UI 材料至少覆盖：空板快速创建、已选中 Sticky 与 Text、IME 合成中、RTL 与长文本、窄屏和触摸键盘、只读权限、保存中/失败/重连、Delete 后 Undo/Redo、500 张粘贴预览和超限反馈。既有 S01 图片只覆盖画布表面，不能代替本束这三件签核的 UI 部分。Dock 方向应与 `2026-09-26-library-bottom-dock.md` 一致，旧 `02-object-authoring.md#R8` 的左侧工具描述须在正式签核时消解冲突。

## ② 用例与异常路径

| 用例 | 主路径 | 必须明确的失败/边界 |
|---|---|---|
| BV04 直接输入 | 双击空白或 N 创建 Sticky；dock 创建 Sticky/Text；输入、改形状/颜色/字号/层级/尺寸后刷新及第二客户端可见 | IME composition 不触发提交、全局 N/Tab/Delete；RTL 不反转存储文本；长文本不丢字、不遮挡操作；远端删除时结束编辑，不复活对象 |
| BV05 连续创作 | 第一张后 Tab 以 24px 邻近方向继续；无趋势横向，明确纵向趋势纵向；10 张计时验收 | 输入中的 Tab 行为需与继续创作明确区分；只读、离线未确认、重复按键不能产生意外对象 |
| BV05 批量粘贴 | 多行内容经预览选择拆成 Sticky；500 张保持稳定次序和位置；一个语义 operation/Yjs transaction | 空输入、HTML/脚本、超限、部分无效行不得半写；错误后原粘贴内容可恢复 |
| BV05 删除/撤销 | 创建、编辑、移动、Delete 可 Undo/Redo；删除 Undo 保持原 id 和引用 | 无历史、冲突、权限变化及服务端拒绝应有可理解反馈；“已保存/已撤销”晚于权威确认 |

BV05 的本轮“基础”撤销边界必须与 BV22 区分：多人字段级不覆盖他人写入、认证 tombstone restore、离线幂等队列与损坏恢复点属于 BV22 完整语义；BV05 不应通过宣称 BV22 完成来补验收。但删除恢复原 id 是 `02-object-authoring.md#R3/R12` 已写的可见要求，签核前必须裁决服务端协议是否足以承接，不能只靠本地 Yjs UndoManager 假定安全。

## ③ API/协议草案与领域不变量

不新增一套对象 HTTP CRUD。对象写入仍经 `whiteboard-core` 的类型化 command envelope、ACL 校验、Yjs transaction、服务端确认和既有持久化边界；Fabric 只是可丢弃投影。将来公开 operation API 与此共用校验/幂等语义，不能暴露 Fabric JSON。

1. `(boardId, clientId, gestureId)` 标识一次用户语义动作；批量 500 张共享一个 gesture/transaction，逐项有稳定 object id 与确定顺序，失败原子回滚。重复提交只应用一次。
2. `Y.Map key == BoardObject.id == Fabric data.boardObjectId == DOM mirror key`；删除后的 Undo 必须恢复同一 id，不能复制一个新对象。单调 tombstone 需要认证恢复路径，不能由 UI 直接清零。
3. 文本内容的事实源是领域/Y.Text；IME 临时 composition 和未提交草稿留在编辑器本地。提交/取消与远端字段更新的合并语义应写进正式用例。
4. 形状、颜色、字号、层级、尺寸模式是类型化领域字段；世界坐标在 Board model，viewport/selection 不进入对象内容；不将 Fabric 私有状态持久化。
5. Owner/Editor 才能写；Commenter/Viewer 的前端禁用只是体验，command/API/WS 入口仍须拒绝。成功提示依权威确认，断线时保留待确认状态。

**需裁决的尺寸词汇**：BV04 写 `normal/free/auto-height`，当前 `packages/whiteboard-core/src/thinking-input.ts` 的 `StickySizingMode` 是 `fixed/auto-size/auto-height`。正式束须给出一对一语义、拖拽/内容增长优先级和迁移规则，选一个单一事实源；不能在 UI 与 schema 各存一套含义不同的枚举。

## 最新 main 与 #4524 的重叠风险、验收差距

本地 main 已有 `collaborative-thinking-editor.tsx` 的创建、行内编辑、Tab 继续、Delete/Undo/Redo 和 dock 入口，以及 `thinking-input-editor.tsx` 的 composition 处理、`whiteboard-core/src/thinking-input.ts` 的类型化创建与 `undo.ts` 的历史逻辑。这些是实现线索，不是 BV04/BV05 完成证据。当前 `parseBulkStickyLines` 与 `createStickyBatchEnvelope` 的上限均为 **100**，UI 也提示最多 100 行；它与 BV05 明写的 **500 张、一次 transaction** 冲突，需先裁决容量、性能与失败原子性，再同步 UI、领域限额和验证。

#4524 的本地合并引用与 main 的差异覆盖 `collaborative-thinking-editor.tsx`、`board-bottom-dock.tsx`、`object-context-toolbar.tsx`、`thinking-input-editor.tsx`、`whiteboard-core/src/thinking-input.ts`/`undo.ts` 等本束热点。由于该引用与当前 main 分叉较早，不能把整段分支差异认定为 #4524 的最终净改动；实施前应在可联网环境读取 PR 当前 head/base、changed files 和 review，并以最新 main 重算净差异，逐项标识“已合入/待合入/冲突”。尤其不得并行重写上述热点或把 #4524 已实现的行为重复算作新 feature 证据。

当前 `feature_list.json` 中 BV04/BV05 均为 `not_started`、未入 sprint，且 BV04 依赖 BV03、BV05 依赖 BV04。`design-coherence.md` 的 `covers_bundles` 只含 `board-fabric-surface`。因此本草案不构成开工许可：下一步需制作真实 UI 材料、正式 `board-authoring` 束的 UI/用例/API/领域/覆盖材料，由人类完成三件签核并扩展阶段一致性复核；随后按 harness 流程入 sprint、同步 issue，再实现与验证。不要改签核状态来跳过这些门。

本次逐项核对还发现：BV04/BV05 列出的五条 `apps/web/tests/ui/...` 与 Playwright 标题目前并无对应测试文件或用例名；已有测试入口是 `apps/web/e2e/board-thinking-input.spec.ts`、`packages/whiteboard-core/tests/thinking-input.test.ts` 和 `undo-conflict.test.ts`。因此正式实施需先补能证明验收指标的断言，不能把现有测试通过解释为 BV04/BV05 已验收。

## 建议的可执行验证

沿用 feature 清单现有命令，完成正式束后补上缺口断言：

```bash
pnpm --filter web exec vitest run tests/ui/board-sticky-text-editing.test.tsx tests/ui/board-sticky-resize-modes.test.ts
pnpm --filter web exec playwright test -c playwright.config.ts -g 'sticky text IME'
pnpm --filter web exec vitest run tests/ui/board-sticky-quick-capture.test.tsx tests/ui/board-bulk-sticky-transaction.test.ts
pnpm --filter web exec playwright test -c playwright.config.ts -g 'TTFI <5s|10 stickies <30s'
pnpm --filter web exec playwright test -c playwright.config.ts -g 'basic create edit delete undo redo'
```

上述路径/标题是 feature 清单中的完成契约，不能因命令存在就宣称已通过。另需在真实正式路由用两个浏览器和服务端审计/持久化证据核验：500 张只产生一个 transaction、刷新与第二客户端顺序一致；IME/RTL/长文本无误提交；只读拒写；Delete→Undo 原 id 与引用不变；网络延迟/拒绝时不提前提示成功。计时数据应保存运行环境、样本量、起止点和原始日志。
