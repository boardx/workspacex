# `board-authoring` — ③ 命令与协议评审草案（未签核）

此文仅描述 BV04/BV05 准备采用的协议边界，不是新的 HTTP API 或第二份 schema。可执行单源仍为 `packages/contracts/src/whiteboard-document.ts` 的 `WhiteboardObject`、`WhiteboardCommand`、`WhiteboardCommandBatch` 与 `packages/whiteboard-core/src/command-port.ts` 的 `BoardCommandEnvelope`。正式契约束获签前不修改这些类型。

## 现有入口及必须保持的行为

| 操作 | 现有命令 / 调用 | 设计要求与回执 |
|---|---|---|
| 创建 Sticky/Text | `create`，经 `BoardCommandPort.dispatch` | 服务端校验角色与对象；回执给 `operationId`、`transactionId`、`acceptedObjectIds`，UI 随后把焦点给对象内文字层。焦点不是持久字段。 |
| 改文字、样式、尺寸 | `text`、`style`、`geometry`、`extension` | 同一完成手势归入同一 `gestureId`。IME 合成中不得 dispatch；属性变化通过 canonical 对象重投影到 Fabric。 |
| Tab 接续 | 一条 `create` | 相邻方向在客户端根据世界坐标计算；24px 间距。新 id 由调用方生成，同一 `gestureId` 重试不得多出一张。 |
| 批量 500 张 | 一次 envelope，500 条 `create` | 预览时零写；校验全量 id、文本和位置后一次 dispatch/Yjs transaction。返回 500 个按输入顺序排列的 id；失败零写，保留输入。现有通用 `WHITEBOARD_LIMITS.batch = 1000` 容纳 500 条，但专用 parser 与 envelope 目前硬限制 100，必须同步修改并做容量反证。 |
| 删除、撤销、重做 | `delete`；受控 `restore` 或历史逆向操作 | 同一逻辑 id 恢复，连接/评论引用不改 id。恢复必须有服务端可验证的删除回执与授权；客户端不能仅删除 tombstone 或伪造 `restore`。成功提示等待权威 ACK。 |

`BoardCommandPort` 当前的幂等表仅在单个 Y.Doc 生命周期内有效；跨重连、跨进程、服务端 ACK 重放须依赖协作宿主的持久回执。不能拿本地端口测试代替双客户端/重启验收。`WhiteboardCommandBatch` 的上限是命令数，Board 总对象数仍受 `WHITEBOARD_LIMITS.objects` 约束；达到容量时 500 条整批拒绝。

## 尺寸词汇的推荐裁决

需求的“Normal Resize / Shift Free Resize”描述**拖拽手势约束**，不是内容尺寸模式。建议保留现有持久 `sticky.sizing: fixed | auto-size | auto-height` 单源，并将“保持比例 / Shift 自由改变比例”作为画布交互规则，不再增加另一个持久枚举。创建默认 `auto-height`；普通拖角按形状约束比例，Shift 拖角自由调整，拖拽完成后提交 `geometry`。用户明确选择“固定尺寸”才切到 `fixed`；自动高度对长文本扩展有效，`auto-size` 随内容调宽高。如此无需迁移旧对象，也避免把 `normal/free` 与 `auto-height` 放进互斥三选一。圆形与方形的自动高度、拖动后模式优先级仍须在用例和 Fabric 适配器测试中定死，不能仅靠菜单文案推断。

## 错误与权限

- 无效行、501 行、重复 id、单对象文本超限、总对象容量不足：在 dispatch 前返回可定位的输入错误；任何情况下不允许部分创建。
- Viewer/Commenter：即使绕过 dock 直接发送 envelope，也由服务端拒绝；UI 保留阅读、选中与复制只读内容的能力。
- 服务断开或 ACK 超时：本地编辑草稿可恢复，状态是“待确认/保存失败”，不能显示“已保存”。同一 `gestureId`、同一 payload 可安全重试；不同 payload 同 key 拒绝。
- 远端 tombstone 与本地编辑冲突：不得因晚到文字命令复活对象。保留本地未提交文字供用户复制，事件与失败原因可观察。

正式签核前要把每个操作映射到仓库内唯一的契约实现、服务端权限入口和可运行反证测试；此草案不宣称这些验证已存在或已通过。
