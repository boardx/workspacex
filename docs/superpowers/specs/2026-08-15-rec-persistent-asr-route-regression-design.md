# `/rec` 持久化 ASR 路由回归修复设计

## 目标

恢复已经由 F173 签核并合入的个人实时转录持久化链路，撤销 issue #1241 / PR #1245
对 `/rec` 做的临时“不落库”降级。修复后，最终识别文本在刷新、重新进入和后续续录时仍然存在。

本修复关联 issue #1268。它不新增外部协议，也不改变 Chat 的草稿转录行为。

## 事实与根因

- 服务端个人转录链路仍然存在：一次性 ticket、owner/org 校验、个人 WebSocket gateway、
  `appendFinal`、`finishCapture` 和 PCM 用量记录均已实现。
- `/rec` 当前在 `apps/web/components/rec/transcription-history.tsx` 中调用
  `openAsrDraftStream()`。该客户端连接 `/chat/asr-draft`，按契约明确不落库。
- 当前页面收到 final 后只更新 React state，正文编辑也只更新 React state，因此刷新必然丢失。
- 这段行为来自 PR #1245 的临时恢复方案，不是个人持久化后端缺失。

## 方案

### 前端连接

`/rec` 恢复调用现有 `openBoardxRealtimeAsr(transcriptionId, ...)`：

1. 先通过受保护 HTTP 接口为当前个人转录申请一次性 ticket；
2. 使用 ticket 连接个人 BoardX WebSocket；
3. AudioWorklet 继续发送 mono 16 kHz PCM16 little-endian；
4. 只消费 BoardX `ready`、`interim`、`final`、`completed`、`error` 事件。

`/chat/asr-draft` 保持不变，继续只服务 Chat composer 的临时草稿识别。

### 文本与停止

- interim 只在当前页面展示，不落库。
- final 由后端串行执行“先 `appendFinal`、后推送”；前端按 `segmentId` 去重并连续拼接正文。
- 用户停止时，前端发送 finish 并等待 `completed`，随后重新读取个人转录详情，以数据库正文
  覆盖页面快照。
- 停止失败时保留已经落库的 final，并显示稳定错误；不得把临时 interim 当成已保存正文。
- 正文编辑恢复调用现有持久化 PATCH，而不是只更新本地 state。

### 遗留状态兼容

后来加入的遗留 capture 恢复逻辑保留：如果详情状态为 `recording` 但当前浏览器没有活动
stream handle，停止按钮调用现有 stop HTTP 接口，使遗留 capture 进入终态。永久删除仍先要求
没有活动 capture；由现有 stop/delete 操作完成，不把删除改成隐式强杀当前真实录音。

## 不变量

1. 不新增依赖，不新增数据库迁移，不新增 ASR 配置。
2. 不改变 F173 已签核的外部 HTTP/WS shape。
3. 不改变 `/chat/asr-draft`。
4. 不把长期 JWT 放入 WebSocket URL；只使用一次性 ticket。
5. final 落库成功前不得向浏览器发布。
6. 同一 final 事件不得重复追加。
7. 后续 capture 继续追加同一份个人正文，不引入“转录已永久完成”的文档终态。

## 错误处理

- ticket、连接、Provider、格式、额度错误继续映射为现有稳定 BoardX reason。
- WebSocket 或 AudioWorklet 清理必须幂等，重复 stop/unmount 不得抛未处理异常。
- `completed` 前连接失败时保持已落库正文可重新读取；UI 不声称 interim 已保存。

## 验证

先补回归测试并确认在当前 `/chat/asr-draft` 接线下失败，再做最小实现：

- `/rec` 必须调用个人持久化客户端，不能调用 `openAsrDraftStream`；
- final 去重并追加，停止后重新读取持久化详情；
- 正文编辑调用持久化 PATCH；
- 遗留 `recording` 且无本地 handle 时仍能 stop；
- 个人 gateway 保持 final 先落库后推送、停止完成和资源清理测试；
- Web/API typecheck 与相关 harness 验证通过。

## 风险与回滚

主要风险是 devapp 反向代理未暴露个人 WebSocket。验证必须覆盖真实 ticket 返回的 WS 地址和
部署路由，不能仅依赖组件 mock。若部署面失败，应修复个人 WS 路由/反代；不得再次静默回退到
不落库的 Chat 草稿流。回滚只撤销本修复的前端接线，不修改数据库中的既有正文。
