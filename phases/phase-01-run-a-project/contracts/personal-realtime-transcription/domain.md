# `personal-realtime-transcription` 领域与不变量

## 实体

- `PersonalTranscription`：用户私有转录文档，只存名称、标签、owner 与聚合状态。
- `RecordingSession`：一次 capture run；复用既有 recording session。
- `RecordingSegment`：唯一逐字稿事实源；只保存 final。
- `RealtimeAsrTicket`：绑定 user/org/transcription/capture 的一次性授权摘要。
- `AliyunAsrTask`：一次 Fun-ASR 上游任务及其用量、终态和失败原因。

## 不变量

- I-1：任何读写都满足 `personal_transcriptions.owner_user_id == actor.userId`；组织管理员没有正文旁路。
- I-2：`PersonalTranscription` 不存逐字稿正文；正文只存在于 `recording_segments`。
- I-3：`source_type='personal'` 时 `recording_sessions.project_id IS NULL`，且 `source_ref_id` 必须指向同 org、同 owner 的转录文档；其它 source type 的 project 约束不变。
- I-4：一个转录文档同一时刻最多一个未结束 capture run。
- I-5：interim 永不落库；final 必须落库成功后才能推送给客户端。
- I-6：同一 `captureId + upstreamSentenceId` 至多产生一个 segment。
- I-7：ticket 原文不落库，摘要一次原子消费；过期、已消费或绑定不匹配时不能建立 WebSocket。
- I-8：Fun-ASR `task-started` 前向上游发送的 PCM 字节数恒为 0。
- I-9：客户端 stop 后不再接受新 PCM；`task-finished` 且所有 final 写入完成前不得发送 completed。
- I-10：每个上游 task 的最终累计用量最多记账一次。
- I-11：API Key 只存在于服务端环境和上游 Authorization 头，浏览器永不可见。
- I-12：结束、失败、断线和卸载后麦克风轨、AudioContext、缓冲、计时器与两侧 WebSocket 均释放。
