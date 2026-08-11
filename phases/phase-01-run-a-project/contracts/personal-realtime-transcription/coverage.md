# `personal-realtime-transcription` 覆盖矩阵

| UC-5.5 验收 | API / 状态机 | UI 消费点 | feature |
|---|---|---|---|
| V1 用户私有、管理员无正文旁路 | list/read owner predicate + RLS/integration test | `rec-history-grid` | F158 |
| V2 final 先落库且刷新不丢不重 | segment ingestion + read detail | `rec-live-transcript` | F158 F159 F160 |
| V3 task-started/task-finished 顺序 | Fun-ASR adapter state machine | `rec-live-status` `rec-live-toggle` | F159 F160 |
| V4 ticket 过期/重复/跨会话拒绝 | ticket issue + atomic consume | 可见错误态 | F159 |
| V5 AudioWorklet PCM 格式 | browser worklet | `rec-live-toggle` | F160 |
| V6 单按钮、收尾门禁 | BoardX completed event | `rec-live-toggle` `rec-live-transcript` | F160 |
| V7 多 capture 汇总 | issue ticket creates capture + read aggregate | 同一详情页 | F158 F159 F160 |
| V8 用量只记一次 | task usage idempotency | 状态/额度错误 | F159 |

反向覆盖：本束只新增 create/list/read/ticket/WS 五个入口；每个入口均由上表至少一条验收消费，不存在孤儿 API。
