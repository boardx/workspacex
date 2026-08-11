# 实时转录工作台与 Fun-ASR 设计规格

## 1. 目标与范围

把现有 `/rec` 演示页改造成可真实使用的实时转录工作台：用户可以浏览跨项目历史转录，创建带名称和标签的新转录，使用麦克风进行实时识别，停止后等待尾部结果完成并持久化；完成的逐字稿可以作为带原文引用的上下文交给 Skill 做总结、分析和报告。

本规格覆盖四个可独立交付的能力：

1. 历史转录与新建转录 UI。
2. 短期一次性 WebSocket ticket 与 BoardX 稳定事件协议。
3. 浏览器 AudioWorklet PCM 管线和后端阿里云百炼 Fun-ASR 状态机。
4. 转录落库、用量记账，以及完成后的 Skill 分析入口。

本次不实现说话人身份自动识别、跨场次声纹库、浏览器直连阿里云或新的模型依赖。Fun-ASR 实时模型不提供说话人分离，因此多人发言在本阶段保存为同一场会话中的有序转写段；后续人工说话人指派继续复用现有 recording 束的能力。

## 2. 已确认的产品体验

### 2.1 历史转录首页

视觉单一来源为用户选定的方案 3 截图：

`/Users/shenyangjun/.codex/generated_images/019fefa2-5f13-7a22-8b13-fb94b73ce1f2/exec-86ddbc89-cf37-4b2c-944b-5a98aebf08fd.png`

- 使用 BoardX 现有全局图标导航，不保留旧 `/rec` 的第二级左栏和右侧轨道。
- 主区域顶部展示面包屑、`历史转录 · N`、说明文字和右上角 `+ 新建转录`。
- 筛选区包含标签筛选、名称或内容搜索、最近更新排序。
- 历史记录以四列卡片网格展示；卡片包含名称、来源/项目、创建者、摘要、标签、时长、日期、状态和打开入口。
- 网格末尾保留虚线 `新建转录` 卡片，和右上主按钮触发同一个动作。
- 数据加载、空列表、请求失败和已归档都必须有明确可见状态。

稳定测试锚点：

- `rec-history-page`
- `rec-history-count`
- `rec-history-search`
- `rec-history-sort`
- `rec-history-tag-<tag>`
- `rec-history-grid`
- `rec-history-card-<sessionId>`
- `rec-history-empty`
- `rec-history-error`
- `rec-create-open`

### 2.2 新建转录弹窗

- 标题为 `新建转录`，说明 `创建后将立即进入实时转录`。
- 名称必填，去除首尾空格后长度为 1–100；显示字符计数。
- 标签可选，最多 5 个；按回车加入，重复标签不重复创建，单个标签长度为 1–20；显示标签计数。
- 取消关闭弹窗且不创建任何记录。
- `开始实时转录` 在名称合法且未提交时可用；重复点击只创建一次。
- 成功创建后进入该转录详情并请求麦克风权限；创建失败时保留名称与标签，可安全重试。

稳定测试锚点：

- `rec-create-dialog`
- `rec-create-name`
- `rec-create-name-count`
- `rec-create-tags`
- `rec-create-tag-count`
- `rec-create-cancel`
- `rec-create-submit`
- `rec-create-error`

### 2.3 实时转录详情

- 详情页顶部保留返回、名称、录制状态和连接信息。
- 页面主区域只包含一个 `开始转录 / 停止转录` 切换按钮和一块全宽逐字稿内容区；不在实时转录详情内展示分析、报告、引用或 Skill 面板。
- 未录制或已停止时按钮显示 `开始转录`；录音中显示 `停止转录`；正在接收尾部结果时按钮显示 `正在收尾` 且不可重复点击。
- 逐字稿按 `finalSegments` 与当前 `interimSegment` 分开维护；中间结果替换当前临时段，最终结果只追加一次，不能重复拼接。
- 状态覆盖：正在连接、等待 ASR、录音中、重连中、正在收尾、已完成、麦克风被拒、无设备、网络错误、额度不足、服务未配置。
- 点击停止后立即停止采音，界面进入 `正在收尾`；只有后端发出 `completed` 后，按钮才恢复为 `开始转录`。
- Skill 分析仍属于转录完成后的下游能力，但不占用本详情页；后续从独立对话或报告流程引用已持久化的最终段。

稳定测试锚点：

- `rec-live-workspace`
- `rec-live-title`
- `rec-live-status`
- `rec-live-toggle`
- `rec-live-transcript`

## 3. 架构边界

### 3.1 前端

计划文件职责：

- `apps/web/components/rec/rec-app.tsx`：路由级 UI 与页面状态协调。
- `apps/web/components/rec/realtime-transcription-dialog.tsx`：新建、录制、停止、收尾和错误状态。
- `apps/web/lib/realtime-asr/boardx-realtime-asr-client.ts`：只理解 BoardX ticket 与事件，不理解阿里云原始事件。
- `apps/web/lib/realtime-asr/pcm-audio-worklet.ts`：请求麦克风、装载 AudioWorklet、转成单声道 16 kHz PCM16 little-endian。
- `apps/web/lib/realtime-asr/realtime-asr.types.ts`：从 `@repo/contracts` 导出的前端类型别名，不再依赖旧会话类联合类型。

前端不得持有 `DASHSCOPE_API_KEY`，不得把长期 JWT 放进 WebSocket URL，也不得自行写 ASR 最终段到数据库。

### 3.2 BoardX API 与 WebSocket

新增受 JWT 保护的会话创建接口：

`POST /recording/realtime-asr/sessions`

输入：

```ts
{
  projectId: string;
  name: string;
  tags: string[];
}
```

输出：

```ts
{
  sessionId: string;
  ticket: string;
  expiresAt: string;
  websocketPath: string;
}
```

约束：

- 长期 JWT 只用于这次 HTTPS 创建请求。
- ticket 约 60 秒有效、一次性、只允许打开指定 `sessionId` 的 ASR WebSocket。
- 服务端保存 ticket 的不可逆摘要与 `userId/orgId/projectId/sessionId/expiresAt/consumedAt`；原文只在创建响应出现一次。
- WebSocket 升级时原子消费 ticket；过期、重复、会话不匹配、用户/团队无权、额度不足均在升级阶段拒绝。
- 不把 ticket 写入日志、数据库明文字段或可持久浏览器存储。

BoardX WebSocket：

`WS /recording/realtime-asr/sessions/:sessionId/stream?ticket=<one-time-ticket>`

客户端发送：

```ts
type BoardxAsrClientEvent =
  | { type: "start" }
  | { type: "stop" }
  | ArrayBuffer; // PCM16 / 16 kHz / mono / little-endian
```

服务端发送：

```ts
type BoardxAsrServerEvent =
  | { type: "ready"; sessionId: string }
  | { type: "interim"; text: string; beginMs: number; endMs: number }
  | { type: "final"; segmentId: string; text: string; beginMs: number; endMs: number }
  | { type: "stopping" }
  | { type: "completed"; sessionId: string; durationSeconds: number }
  | { type: "error"; code: BoardxAsrErrorCode; retryable: boolean };
```

`BoardxAsrErrorCode` 是封闭枚举：`TICKET_INVALID`、`TICKET_EXPIRED`、`TICKET_USED`、`NO_PROJECT_ROLE`、`QUOTA_EXCEEDED`、`ASR_NOT_CONFIGURED`、`CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`、`ASR_PROVIDER_UNAVAILABLE`、`AUDIO_BACKPRESSURE`、`START_TIMEOUT`、`FINISH_TIMEOUT`、`PROTOCOL_ERROR`。

### 3.3 阿里云 Fun-ASR 状态机

后端使用现有 `ws` 依赖直接连接百炼，不新增 SDK 依赖。环境变量：

```env
ALIYUN_ASR_MODEL=fun-asr-realtime
ALIYUN_ASR_REGION=cn-beijing
ALIYUN_ASR_WORKSPACE_ID=...
DASHSCOPE_API_KEY=...
```

北京默认上游地址：

`wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`

状态机：

```text
created
  -> connecting-upstream
  -> waiting-task-started
  -> streaming
  -> finishing
  -> completed
```

失败可以从任意非终态进入 `failed`；资源清理后进入 `closed`。

严格顺序：

1. 后端连上阿里云后立即发送 `run-task`，模型、PCM、采样率、标点、热词和上下文全部由后端组装。
2. 收到阿里云 `task-started` 前，不向上游发送任何 PCM；客户端提前到达的音频进入有界缓冲区。
3. `result-generated.sentence_end=false` 映射为 `interim`，不落库。
4. `result-generated.sentence_end=true` 先调用既有转写段摄取用例落库，成功后再发 `final`。
5. 客户端 `stop` 后停止接受新音频，发送阿里云 `finish-task`，继续接收尾部 `result-generated`。
6. 收到 `task-finished` 后记录用量、结束 recording session，再发送 `completed`。
7. `task-failed`、启动/收尾超时、连接中断均映射成稳定 BoardX 错误码，并清理 ticket、缓冲区、计时器和两侧 WebSocket。

阿里云 `payload.usage.duration` 只在最终句结果中出现时更新本场累计计费秒数；以任务最终累计值或服务端去重后的最大值记一次模型调用日志和额度扣减，禁止每个中间事件重复扣费。

## 4. 数据与持久化

复用现有 `recording_sessions`、`recording_tracks`、`recording_segments`、额度服务和模型调用日志服务，不引入新的数据库客户端或日志系统。

新增最小元数据：

- `recording_sessions.name`
- `recording_sessions.tags`（受契约约束的字符串数组）
- 一次性 ASR ticket 表或现有安全令牌仓储中的专用记录
- 上游任务 ID、最终计费时长和完成/失败原因的审计字段

不变量：

- 中间结果永不落库。
- 每个 `final` 先落库后推送；刷新页面后仍可读回。
- `segmentId` 与上游 `sentence_id`/会话 ID 组合形成幂等边界，重连重放不得新增重复段。
- 转录详情、Skill 上下文和报告引用均读取同一组最终段，不建立第二份逐字稿事实源。
- 用户只能读取本组织、本人有项目角色的转录；数据库查询继续受 org/project 边界约束。

## 5. 背压、重连与资源清理

- 浏览器只在 `ready` 后开始持续发送音频；连接中断时暂停采音帧发送并显示重连状态。
- 前后端缓冲均设置字节上限；超过上限返回 `AUDIO_BACKPRESSURE` 并停止会话，不允许无界增长。
- ticket 一次性，WebSocket 断线不能用原 ticket 重连；客户端通过受 JWT 保护的恢复接口领取绑定同一未结束 session 的新 ticket。
- 重连只恢复未完成会话；已完成/失败会话不能重新进入 streaming。
- 客户端卸载、主动取消、服务端异常和上游断线都必须停止麦克风轨、关闭 AudioContext、清空缓冲、取消计时器并关闭两侧 WebSocket。

## 6. 安全与隐私

- API Key 只存在于服务端环境变量和发往阿里云的 Authorization 请求头。
- ticket 不替代应用身份，仅授权一次特定 ASR 升级；创建与升级均做用户、组织、项目、会话和额度校验。
- 未取得麦克风许可不创建音频轨；撤销许可后不再发送新帧。
- 机密项目继续沿用已确认的 fail-closed 规则：外部 ASR 被禁止时返回 `CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`，不提供“确认后继续”绕行；缺少服务端配置才返回 `ASR_NOT_CONFIGURED`。
- 上游 `error_message` 只写服务端结构化日志，不原样回传浏览器，日志必须脱敏 API Key、ticket 和音频内容。

## 7. 交付拆分

### A. 历史工作台与创建元数据

用户可从全局导航进入 `/rec`，按标签/搜索/排序浏览真实历史记录；创建名称与标签后得到持久化 recording session 并进入详情。

### B. 短期 ticket 与 Fun-ASR 后端状态机

JWT 创建 ticket，WebSocket 原子消费 ticket，后端按阿里协议完成 `run-task -> task-started -> result-generated -> finish-task -> task-finished`，最终段落库并记录用量。

### C. AudioWorklet 与实时状态 UI

浏览器显式生成 PCM16/16 kHz/mono/little-endian 帧；UI 正确维护 final/interim，停止后等待 completed，并覆盖权限、重连、背压和超时状态。

### D. 已保存转录的 Skill 分析

完成会话可调用已授权 Skill 做总结、分析、报告或引用提取；产出保留 segment/timecode 来源并进入既有产物保存链路。

四项分别成为一个 feature、一个 issue、一个 Delivery PR。B 先于 C，A 可与 B 独立，D 依赖 A/B/C 全部完成。

## 8. 验证策略

- 契约测试：短期 ticket 过期、重复、跨会话和跨租户均拒绝；所有 BoardX 事件通过 `@repo/contracts` schema。
- 状态机单元测试：PCM 只在 `task-started` 后发送；`finish-task` 后继续接收 final；仅 `task-finished` 触发 completed。
- 数据集成测试：final 先落库后推送；刷新后读回；同一上游句重放不重复；用量只扣一次。
- 前端组件测试：名称/标签校验、筛选/搜索/排序、final/interim 去重、停止后按钮门禁。
- 音频测试：AudioWorklet 对双声道输入混为单声道，降采样为 16 kHz，并输出 16-bit little-endian PCM。
- E2E：从真实导航进入历史页，创建转录，使用可控假上游完成一段 interim/final/stop/completed，刷新后仍存在，再触发 Skill 并断言引用。
- 视觉 QA：在与参考图相同的 1488×1058 视口、创建弹窗打开状态下截图对比；修复 P0/P1/P2 后 `design-qa.md` 才能写 `final result: passed`。

## 9. 官方协议依据

- 阿里云 Fun-ASR WebSocket API：<https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api>
- 阿里云 Fun-ASR 客户端事件：<https://help.aliyun.com/zh/model-studio/fun-asr-client-events>
- 阿里云 Fun-ASR 服务端事件：<https://help.aliyun.com/zh/model-studio/fun-asr-server-events>
- 阿里云地域与 Workspace 专属域名：<https://help.aliyun.com/zh/model-studio/regions/>
