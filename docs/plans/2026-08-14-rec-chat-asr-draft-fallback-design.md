# `/rec` 临时复用 Chat ASR 草稿流设计

Issue: #1241

## 目标

在个人实时转录专用 WebSocket 路由尚未稳定部署期间，让 `/rec` 直接复用已经可用的
`/chat/asr-draft`，恢复浏览器采音、实时识别与停止收尾能力。

## 用户可见行为

- 转录名称、标签和历史卡片继续通过个人转录 REST API 持久化。
- 点击“开始转录”后使用 Chat ASR 草稿流识别，最终文本在当前页面连续拼接展示。
- 当前 interim 文本单独展示，收到 final 后清空，避免重复。
- 点击“停止转录”先停止采音，再等待服务端 `asr.finished`，最后回到可继续转录状态。
- 当前页面支持复制全文和本地修改正文。
- 转录正文不写入个人转录 API；刷新、返回历史列表或重新打开后正文消失。
- 页面明确提示“当前文字仅保存在本页面，刷新或离开后消失”。

## 技术方案

`TranscriptionHistory` 继续负责名称、标签、列表、编辑元数据和删除等既有功能，但实时流由
`openBoardxRealtimeAsr` 切换为现有 `openAsrDraftStream`：

1. `onPartial(text)` 更新 `interimSegment`。
2. `onFinal(text)` 将文本追加进组件内的 `activeSession.content`，然后清空 interim。
3. `onFinished()` 将流状态恢复为 idle。
4. `onError(reason)` 映射为稳定中文错误并释放当前句柄。
5. `stop()` 只等待 Chat 草稿流完成，不再重新读取个人转录详情。

正文编辑改为组件内状态更新，不调用 `updatePersonalTranscriptionContent`。创建、读取名称与标签、
更新元数据和删除会话仍保持原样。

## 范围边界

- 不修改 `/chat/asr-draft` 后端协议与 Chat 页面。
- 不申请个人 ASR ticket，不调用个人 WebSocket，不写 capture、segment、usage 或正文。
- 不删除个人持久化链路；后续专用路由恢复后可切回。
- 历史会话中既有的已持久化正文仍可读取；本次临时识别新增的文字不会写回。

## 验证

- UI 测试断言点击开始只调用 `openAsrDraftStream`，并携带当前 session token。
- partial/final 事件驱动页面展示，多个 final 按顺序连续拼接。
- 点击停止调用草稿流句柄 `stop()`，不调用详情刷新或正文更新 API。
- 本地编辑只更新当前页面，不调用正文持久化 API。
- 页面显示临时不保存提示。

## 风险与恢复

该方案主动牺牲正文恢复、个人用量归属和服务端审计，只用于临时恢复实时识别。恢复正式链路时，
应删除本临时分支逻辑并重新启用 `BoardxRealtimeAsrClient`，同时用真实部署验证个人 WebSocket 路由。
