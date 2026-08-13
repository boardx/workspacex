# `/rec` 复用 Chat 实时 ASR Provider · contract delta

Status: proposed; human signoff required.

本文件只定义相对已确认 `personal-realtime-transcription` 束的增量。未列出的个人历史、权限、ticket、BoardX WS、正文、复制与编辑契约全部保持不变。

## 1. 配置单一事实源

Chat、项目/草稿实时 ASR 与个人 `/rec` 共同依赖现有 `ASR_PROVIDER` 对应的 `ConfiguredRealtimeAsrProvider`：

```env
KERNEL_ASR_PROVIDER=aliyun
KERNEL_ASR_BASE_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
KERNEL_ASR_API_KEY=...
KERNEL_ASR_MODEL=qwen3-asr-flash-realtime
```

`DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1` 是 HTTP compatible-mode 地址，不参与实时 ASR。个人路径不再读取 `ALIYUN_ASR_REGION`、`ALIYUN_ASR_MODEL`、`ALIYUN_ASR_WORKSPACE_ID` 或独立 `DASHSCOPE_API_KEY`。

## 2. 内部端口与生命周期

删除个人专用 `PersonalRealtimeAsrProvider` / `PERSONAL_REALTIME_ASR_PROVIDER`。个人 controller 与 gateway 注入现有 `AsrProviderPort`：

```ts
provider.isConfigured()
provider.open(handlers, {
  sampleRate: 16_000,
  channels: 1,
  encoding: "pcm16le",
})
```

`open()` resolve 后发送 BoardX `ready`；`onPartial` 映射 interim；`onFinal` 进入串行 persist-then-publish 队列；stop 后调用 `finish()`，等待写链与用量收口后发送 completed。Qwen WebSocket URL、Authorization、音频 base64 和原始事件解析只能存在于 `ConfiguredRealtimeAsrProvider`。

## 3. 不变量

1. external HTTP/WS route、ticket shape 和 BoardX `ready/interim/final/stopping/completed/error` 不变。
2. `open()` resolve 前不向上游 push PCM；启动缓冲必须有限并执行背压。
3. interim 不落库；final 落库成功前不得推送。
4. completed 是 capture 终态，不是个人文档终态；后续 capture 继续追加同一正文。
5. 共享 Provider 不共享可见性：所有 personal owner/org/ticket predicate 原样保留。
6. 缺配置和上游失败显式报错，不回退 Fun-ASR 或 mock。

## 4. 用量

mono 16k PCM16 的权威输入速率为 `16000 * 1 * 2 = 32000 bytes/s`。个人 gateway 统计成功接收的 PCM 字节；收口时以 `durationSeconds = bytes / 32000` 记账。幂等键使用 capture 与内部 provider-session id，不宣称它是阿里 task id。重复 stop、close 或错误回调不得重复记账。

## 5. 错误映射与清理

- 缺 `KERNEL_ASR_*` → `ASR_NOT_CONFIGURED`。
- Provider 连接/模型拒绝/异常断开 → `ASR_PROVIDER_UNAVAILABLE`。
- 格式拒绝 → `AUDIO_FORMAT_REJECTED`。
- 背压、启动、收尾超时继续使用既有稳定 BoardX 错误。
- 任一终止路径只执行一次清理：capture 状态、上游 session、BoardX socket、缓冲与计时器均释放。

## 6. 兼容与删除边界

不改变 Chat gateway 行为，不改数据库 schema，不改 `/rec` UI。F173 完成时删除个人 Fun-ASR adapter、专用 protocol session、专用 DI token 及其专用测试；所有保留调用点必须只依赖通用 `AsrProviderPort`。
