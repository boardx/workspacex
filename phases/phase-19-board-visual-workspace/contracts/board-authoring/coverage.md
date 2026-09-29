# `board-authoring` — 双向覆盖（待签核）

权威需求：`requirements/02-object-authoring.md` 的 R3/R4/R5/R7/R9/R12，基础历史见 `05-collaboration-history.md` R3/R4/R7。仅覆盖 BV04/BV05；其他对象类型和 BV22 完整协作历史属于后续束。表中操作是 application/command 边界，**不是已经实现的 HTTP API**。

## 需求 → 用例操作 → UI/验证

| 行键 / 需求 | 操作与可观察输出 | 前端消费点及验证 | 当前证据 |
|---|---|---|---|
| BV04-1 / R3.1 | UC-A1 创建 Sticky/Text 后返回 `objectId/focusTarget` | 正式 Board 双击、N、dock；行内焦点；`board-sticky-text-editing` 单测与浏览器 | 设计草案，未验收 |
| BV04-2 / R3.2 | UC-A2 shape、颜色、字号、尺寸意图提交 | 对象浮动菜单与尺寸控点；`board-sticky-resize-modes` | 模式词汇未裁决 |
| BV04-3 / R3.3,R9 | UC-A2 Text 层级、IME、RTL、长文本 | 行内编辑、合成态、第二端；`sticky text IME` 浏览器用例 | 未验收 |
| BV04-4 / R4 E3,R5 | UC-A2 远端删除/只读拒绝 | 冲突提示、草稿恢复、只读菜单；双浏览器/ACL 反证 | 未验收 |
| BV05-1 / R3.1,R4 A1,R12 | UC-A3 Tab 继续，24px 横/纵趋势 | 连续输入及计时 `<5s` / `<30s` 浏览器用例 | 未验收 |
| BV05-2 / R3.6,R4 A2/E4,R7,R12 | UC-A4 粘贴预览，500 张一次原子事务 | 粘贴选项/上限反馈；`board-bulk-sticky-transaction` + 双端审计 | 当前 100 上限，未满足 |
| BV05-3 / R3.7,R12,协作 R3.3/R4 A1 | UC-A5 Delete、Undo/Redo，原 id 恢复 | 快捷键/底部菜单/状态播报；`basic create edit delete undo redo` | restore 边界未裁决 |
| BV05-4 / R5,协作 R7 | UC-A1…A5 ACL、权威确认 | Viewer/Commenter 禁用及直接命令拒绝；延迟 ACK 注入 | 未验收 |

以上 UI 消费点是验收目标，已有[mock 七态截图](../../ui-preview/board-authoring/README.md)与[③协议评审草案](api.md)，尚缺正式路由真实 UI 截图与签核后的协议单源映射。既有 `board-fabric-surface` 截图不能替代本束的编辑态签核。

## 用例操作 → 需求（反向，无孤儿）

| 操作 | 来源需求 | 不属于本束的边界 |
|---|---|---|
| UC-A1 `beginObjectAuthoring` | R2、R3.1、R5、R12 / BV04 | Tile/Image/Shape 创建另束 |
| UC-A2 `editObjectTextAndStyle` | R3.2/R3.3、R4 E3、R9 / BV04 | BV06 Tag/Reaction、完整富文本另束 |
| UC-A3 `continueSticky` | R3.1、R4 A1、R12 / BV05 | AI 批量生成另束 |
| UC-A4 `previewAndCreateStickyBatch` | R3.6、R4 A2/E4、R7、R12 / BV05 | 图片/URL 粘贴另束 |
| UC-A5 `deleteAndUndoAuthoringAction` | R3.7、R12、协作 R3.3/R4 A1/R7 / BV05 | BV22 多人字段历史/离线恢复另束 |

## 门禁与证据边界

正式实现前需补齐真实 UI 截图、可执行③协议单源和 `design-signoff.md`，由人类确认三件并通过阶段一致性复核；BV04/BV05 尚未入 sprint。BV05 可关联仍开放的 GitHub issue #4032；BV04 需建立自己的 issue。`feature_list.json` 中的五个 vitest/Playwright 验证入口是完成契约，当前尚无对应证据。此覆盖矩阵只证明设计上的双向追溯，不证明 UI、API、代码、CI 或端到端已经通过。
