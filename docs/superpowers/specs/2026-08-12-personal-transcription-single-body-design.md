# 个人实时转录单正文设计

## 目标

个人实时转录详情只展示和保存一份连续正文。阿里云每次确认的 final 文本原子追加到正文末尾，不再为个人转录保存或返回分段、时间戳。用户停止转录后可以编辑并保存全文，也可以一键复制当前全文。

## 数据与并发

- `personal_transcriptions.content` 是个人转录正文的唯一事实源，默认空字符串。
- final 仅在服务端确认后以空格分隔原子追加；interim 只在浏览器临时显示，不落库。
- 录音中和正在收尾时禁止人工编辑，避免编辑覆盖实时追加。
- 人工保存采用完整正文替换，并要求当前没有活动 capture；非 owner 返回 not found。
- 历史个人转录迁移时按 capture 开始时间、capture id、segment ordinal 合并旧 final 文本，再删除对应个人 `recording_segments` 行；项目录音分段不受影响。
- capture 仍保留，用于录音状态、时长、用量与审计，但详情 API 不再暴露 capture/segment 列表。

## API

- `GET /recording/realtime-asr/sessions/:sessionId` 返回摘要字段加 `content`。
- 新增 `PATCH /recording/realtime-asr/sessions/:sessionId/content`，输入 `{ content: string }`，返回更新后的详情。
- WebSocket `final` 事件只返回 `captureId`、`segmentId`、`ordinal` 和 `text`；内部 id 用于幂等，前端不展示时间戳。

## UI

- 已确认正文与当前 interim 在同一个连续文本区域中展示。
- 工具栏提供 `复制全文` 和 `编辑`；编辑态提供 `取消`、`保存`。
- 录音中禁止编辑；复制始终复制当前可见正文，不包含状态标签和时间戳。
- 保存成功后退出编辑态；失败保留输入内容并显示错误。

## 验证

- 契约拒绝旧的 `captures` 详情形状，并接受 `content` 与内容更新操作。
- PostgreSQL 验证 final 原子追加、人工替换、owner 隔离、活动 capture 禁止编辑和旧分段迁移。
- UI 验证单正文、无时间戳/分段卡、复制、编辑保存及录音中禁用编辑。

## 人类确认

2026-08-12，用户明确要求“不要现在这种原始分段和时间戳，就直接一直拼接在后面”，并在设计说明后回复“确认”。
