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
- out：元数据、capture runs 与按时间排序的 final segments；无 interim。
- err：`TRANSCRIPTION_NOT_FOUND`。非 owner 同样返回 not found，不泄露存在性。

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

协议顺序：连接上游后发 `run-task`；`task-started` 前只缓冲不转发 PCM；final 先经既有 segment ingestion 落库；stop 发 `finish-task`；`task-finished` 后完成用量记账、结束 capture 并发 completed。

## RetryPersonalTranscriptionCapture

完成或失败后再次领取 ticket 会创建新的 capture run，旧 final 不变；同一文档的详情按 capture 开始时间与 segment ordinal 合并读取。
