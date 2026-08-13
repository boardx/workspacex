# UC-5.6 个人转录复用 Chat 实时 ASR Provider

> 来源：用户 2026-08-13 确认“实时转录模型参考 Chat 的调用模型”。
> 依据等级：共享 Provider、配置单一事实源、个人权限与落库边界为 [人类已确认方向]。
> 元数据：优先级 **P0**；估点 **5**；建议迭代：F173。

## R1 目标与边界

DevApp 只配置 Chat 已在使用的实时 ASR 模型时，个人 `/rec` 也能开始实时转录，不再要求第二套 Fun-ASR 环境变量。共享范围仅包含上游 Provider 与模型配置；个人 ticket、owner/org 鉴权、capture、BoardX WebSocket 事件和最终正文持久化保持独立。

## R2 前置条件

- F165–F167 的个人转录历史、ticket、WebSocket 与 AudioWorklet 已合入 main。
- API 进程配置 `KERNEL_ASR_PROVIDER`、`KERNEL_ASR_BASE_URL`、`KERNEL_ASR_API_KEY`、`KERNEL_ASR_MODEL`。
- `DASHSCOPE_BASE_URL` 仍只服务兼容模式 HTTP，不作为实时 ASR WebSocket 地址。

## R3 主流程

1. 用户在 `/rec` 打开自己的转录并点击“开始转录”。
2. ticket 接口使用与 Chat 相同的 `AsrProviderPort.isConfigured()` 判断就绪。
3. 个人 gateway 通过同一 `ConfiguredRealtimeAsrProvider` 打开 mono/16k/PCM16LE 会话并发送音频。
4. partial 只作为 BoardX interim 推送；final 先原子追加个人正文，再作为 BoardX final 推送。
5. 用户停止时 gateway 等待通用 Provider `finish()`、尾部 final 写链和用量记账全部收口后才发送 completed。
6. 用户之后可再次开始，新 final 继续追加到同一正文。

## R4 异常流程

- 任一必需 `KERNEL_ASR_*` 缺失时，ticket 返回既有 `ASR_NOT_CONFIGURED`，不尝试 mock 或独立 Fun-ASR fallback。
- 上游连接、模型拒绝、音频格式、背压或收尾超时映射为稳定 BoardX 错误；原始上游详情只写服务端日志。
- 失败、断线和页面卸载必须释放浏览器麦克风、BoardX socket、Provider socket 与 capture 状态。
- 非 owner、过期或重复 ticket 仍按原个人转录契约拒绝，不能因共享 Provider 放宽。

## R5 数据与计量

- 不新增数据库 schema，不复制个人正文事实源。
- Qwen realtime 未提供稳定 Fun-ASR usage 时，以 API 已接收的 mono/16k/PCM16 字节数换算时长（32000 bytes/s）。
- 每个 capture/provider session 只记账一次；内部幂等 id 不伪装成阿里 task id。

## R6 UI

不新增或改版页面。沿用已确认的 `/rec` 单一开始/停止按钮、连续正文、复制与编辑交互；前端继续只消费 BoardX stable events，不理解 Qwen 原始事件。

## R7 不包含

- 不改变 Chat 或项目录音的权限、持久化和界面。
- 不由浏览器选择模型，不把上游 API Key 下发浏览器。
- 不保留个人 Fun-ASR fallback，不引入新依赖。

## R8 验收线索

- V1：只配置 `KERNEL_ASR_*` 时 Chat 与 `/rec` 均 configured；删除任一必需值时两者均 unconfigured。
- V2：个人 gateway 注入通用 Provider，明确发送 mono/16k/PCM16LE，并保持 final 先落库后推送。
- V3：32000 PCM bytes 只产生一次 1 秒用量，重复 finish 不重复记账。
- V4：个人 gateway 源码和依赖注入不再引用 `AliyunFunAsrProvider`、`PERSONAL_REALTIME_ASR_PROVIDER` 或 `ALIYUN_ASR_*`。
- V5：既有 `/rec` AudioWorklet 与 BoardX 客户端回归测试通过，stable event 契约不变。
