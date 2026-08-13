# `/rec` 复用 Chat 实时 ASR Provider 设计

## 背景

当前系统有两条阿里云实时转录链路：

- Chat 麦克风通过 `ConfiguredRealtimeAsrProvider` 调用由 `KERNEL_ASR_*` 配置的
  Qwen realtime ASR，使用 OpenAI Realtime 形状的 WebSocket 协议。
- 用户私有 `/rec` 通过 `AliyunFunAsrProvider` 调用 Fun-ASR，使用
  `DASHSCOPE_API_KEY`、`ALIYUN_ASR_*` 和 DashScope `run-task` 协议。

这造成同一个产品同时维护两套模型配置、两套上游协议和两套部署检查。DevApp 已经
配置并实际使用 Chat 的实时 ASR，但 `/rec` 仍会因为独立 Fun-ASR 配置缺失而显示
“当前环境尚未配置阿里云实时转录”。

人类于 2026-08-13 确认：`/rec` 的实时转录模型参考并复用 Chat 的调用模型。

## 目标

让 Chat 与用户私有 `/rec` 共用同一个 `ConfiguredRealtimeAsrProvider` 实例及
`KERNEL_ASR_*` 配置，同时保持 `/rec` 已有的用户私有权限、一次性 ticket、capture、
最终文本持久化、用量记录和多次继续追加行为。

## 非目标

- 不改变 `/rec` 的页面结构、复制、编辑与连续正文交互。
- 不把长期 JWT 或上游 API Key 下发浏览器。
- 不改变 Chat 的麦克风交互或项目录音契约。
- 不增加自动 fallback；统一 provider 未配置或不可用时必须显式报错。
- 不引入新依赖，不由前端选择模型，不在源码维护模型白名单。

## 方案

### 1. 单一上游 Provider

`kernel.module.ts` 中的 Chat `ASR_PROVIDER` 与个人 `PERSONAL_REALTIME_ASR_PROVIDER`
都由同一个 `ConfiguredRealtimeAsrProvider` 配置来源构造。唯一运行时配置为：

```env
KERNEL_ASR_PROVIDER=aliyun
KERNEL_ASR_BASE_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
KERNEL_ASR_API_KEY=...
KERNEL_ASR_MODEL=qwen3-asr-flash-realtime
```

`DASHSCOPE_BASE_URL` 仍只用于兼容模式 HTTP 模型调用，不参与实时 ASR。个人转录不再
要求 `ALIYUN_ASR_REGION`、`ALIYUN_ASR_MODEL`、`ALIYUN_ASR_WORKSPACE_ID` 或独立的
`DASHSCOPE_API_KEY` 配置。

### 2. 用 application 端口适配，不复制协议

保留个人 WebSocket gateway 对 ticket、owner、org、capture、背压和资源清理的控制。
将个人上游依赖从 Fun-ASR 专用会话收敛到通用 `AsrProviderPort`：

- `open(handlers, { sampleRate: 16000, channels: 1, encoding: "pcm16le" })`
- PCM 通过 `AsrSession.pushAudio()` 发送。
- interim 通过 `onPartial` 转为稳定 BoardX interim 事件，不落库。
- final 通过 `onFinal` 先走现有唯一持久化入口，成功后再推送 BoardX final 事件。
- 停止时调用 `finish()`；等待最后一个 final 或超时错误后才发送 completed/error。

不在个人 gateway 内重新实现 `session.update`、base64 音频或 Qwen 事件解析；这些仍只由
`ConfiguredRealtimeAsrProvider` 负责。

### 3. 保持个人转录的不变量

以下行为不因 provider 统一而变化：

- HTTPS 创建 ticket，WebSocket 只携带约 60 秒的一次性 ticket。
- ticket 绑定 user、org、transcription、capture，原子消费且不能复用。
- final 文本先落库后推送；interim 永不落库。
- 每次重新开始产生新 capture，但最终正文继续追加到同一转录文档。
- 非 owner 仍按 not-found 语义拒绝读取或写入。
- 上游 key 只存在于 API 进程。

### 4. 用量语义

Qwen realtime 事件当前不保证提供 Fun-ASR `usage.duration` 形状。因此用量记录改为以
capture 的服务端音频时长为权威输入，并继续以 capture/provider-session 组合幂等。
若现有 `ConfiguredRealtimeAsrProvider` 暂不暴露稳定的 provider session id，则由个人
gateway 为本次上游连接生成只用于幂等的内部 id；不得伪造成阿里 task id。

### 5. 错误处理

- 缺任一 `KERNEL_ASR_PROVIDER`、`KERNEL_ASR_BASE_URL`、`KERNEL_ASR_API_KEY`、
  `KERNEL_ASR_MODEL`：ticket 接口返回现有 `ASR_NOT_CONFIGURED` 产品错误。
- 上游拒绝模型、连接失败或异常断开：映射为稳定的 BoardX provider unavailable 错误，
  详情只写服务端日志。
- 音频格式被拒绝：映射为 `AUDIO_FORMAT_REJECTED`。
- 停止后的尾部 final 未在期限内收口：返回明确错误，不伪装 completed。
- 失败时始终释放浏览器麦克风、BoardX socket、上游 socket 和 ticket/capture 会话状态。

## 契约影响

本设计明确替换 `design-coherence.md` 的 XC-40 前提：不再是“个人 Fun-ASR 与既有
Qwen3 realtime-asr 两条模型路由并存”，而是“个人与 Chat 共享 Qwen realtime provider，
但各自保留独立的鉴权、WebSocket 边界与落库编排”。

需要更新 `personal-realtime-transcription` 束中的：

- `design-signoff.md`：将 Fun-ASR 专用描述改为共享 Chat ASR provider。
- `domain.md`：将 `AliyunAsrTask` 改为通用 realtime provider session。
- `usecases.md`：停止条件从 `task-finished` 改为 provider `finish()` 收口。
- `coverage.md`：用 provider open/final/finish 和持续落库作为验证锚点。
- `design-coherence.md` XC-40：记录新的共享边界并重新进行阶段一致性复核。

由于原束已确认，agent 只能提交上述变更材料，不能自行改签核人的 `status`。运行时代码
必须等待人类对新契约重新确认后才开工。

## 验证策略

1. Provider 单元测试：只配置 `KERNEL_ASR_*` 时，Chat 与个人转录均报告 configured；
   删除任一必需变量时两者均报告 not configured。
2. 个人 gateway 测试：注入通用 provider，证明 PCM 格式、interim 不落库、final 先落库、
   `finish()` 后 completed、异常后资源释放。
3. 反证：移除个人 provider 到 `ConfiguredRealtimeAsrProvider` 的注入后，`/rec` 真链路
   测试必须因 `ASR_NOT_CONFIGURED` 变红，而不是由 mock/fallback 通过。
4. 回归：Chat realtime ASR provider 测试保持原样通过。
5. 浏览器真链路：在只配置 `KERNEL_ASR_*` 的环境中，Chat 和 `/rec` 都能实时出字；停止、
   刷新、继续追加后最终正文不丢不重。

## 风险与控制

- **协议行为差异**：个人链路不再依赖 Fun-ASR `task-started/task-finished`；通过通用
  provider 端口的 `open/finish` 生命周期测试消除对阿里原始事件的依赖。
- **计量漂移**：不臆造上游 usage；使用服务端已接收音频时长并保留幂等门。
- **配置漂移**：部署检查只验证 `KERNEL_ASR_*` 单一事实源，并增加 Chat + `/rec` 双入口
  冒烟，防止一边可用另一边误报未配置。
- **范围扩大**：本次只统一 provider，不重构页面、数据库 schema 或 Chat gateway。
