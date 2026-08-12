# `personal-realtime-transcription` 用例端口

## CreatePersonalTranscription

- HTTP：`POST /recording/realtime-asr/sessions`
- in：`{ name: string(1..100), tags: string[](max 5, each 1..20) }`
- out：`{ sessionId, name, tags, status: "idle", createdAt }`
- err：`AUTH_REQUIRED | ORG_MEMBERSHIP_REQUIRED | VALIDATION_FAILED`

## ListPersonalTranscriptions

- HTTP：`GET /recording/realtime-asr/sessions?query=&tag=&sort=&cursor=`
- out：只返回当前 actor 拥有的文档卡片与分页游标。
- err：`AUTH_REQUIRED | ORG_MEMBERSHIP_REQUIRED`

## ReadPersonalTranscription

- HTTP：`GET /recording/realtime-asr/sessions/:sessionId`
- out：元数据与一份连续 `content` 正文；不返回 capture、分段或时间戳，无 interim。
- err：`TRANSCRIPTION_NOT_FOUND`。非 owner 同样返回 not found，不泄露存在性。

## UpdatePersonalTranscriptionContent

- HTTP：`PATCH /recording/realtime-asr/sessions/:sessionId/content`
- in：`{ content: string }`
- out：更新后的元数据与连续正文。
- pre：actor 是 owner，且当前没有 live capture。
- err：`TRANSCRIPTION_NOT_FOUND | CAPTURE_ALREADY_ACTIVE | VALIDATION_FAILED`

## IssueRealtimeAsrTicket

- HTTP：`POST /recording/realtime-asr/sessions/:sessionId/tickets`
- out：`{ captureId, ticket, expiresAt, websocketPath }`
- pre：actor 是 owner、当前无 live capture、额度可用、Fun-ASR 已配置。
- err：`TRANSCRIPTION_NOT_FOUND | CAPTURE_ALREADY_ACTIVE | QUOTA_EXCEEDED | ASR_NOT_CONFIGURED`

## StreamRealtimeAsr

- WS：`/recording/realtime-asr/sessions/:sessionId/captures/:captureId/stream?ticket=...`
- client：`start | stop | binary PCM16/16k/mono/little-endian`
- server：`ready | interim | final | stopping | completed | error`
- err：`TICKET_INVALID | TICKET_EXPIRED | TICKET_USED | NOT_TRANSCRIPTION_OWNER | QUOTA_EXCEEDED | ASR_NOT_CONFIGURED | ASR_PROVIDER_UNAVAILABLE | AUDIO_BACKPRESSURE | START_TIMEOUT | FINISH_TIMEOUT | PROTOCOL_ERROR`

协议顺序：连接上游后发 `run-task`；`task-started` 前只缓冲不转发 PCM；final 原子追加到 `PersonalTranscription.content` 后再推送；stop 发 `finish-task`；`task-finished` 后完成用量记账、结束 capture 并发 completed。

这里的 `completed` 是 capture 级事件，不是个人转录文档终态。事件送达后文档状态回到 `idle`，用户可再次开始并继续追加正文。

## RetryPersonalTranscriptionCapture

完成或失败后再次领取 ticket 会创建新的 capture run，新的 final 继续追加在原正文末尾。
