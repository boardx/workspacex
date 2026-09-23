---
name: mod-realtime-transcription
description: 实时录音、ASR 流式转录、停止收尾和逐字稿持久化；修改录音或实时转录时使用。
---

# 实时转录模块

负责浏览器录音、音频分段、ASR provider、实时增量、停止收尾和最终逐字稿。

## 代码地图

- 前端：`apps/web/app/rec`、`apps/web/app/itv/live`
- API：`apps/api/src/application/recording`、`apps/api/src/domain/recording`、`apps/api/src/infrastructure/recording`
- 控制器：`apps/api/src/interface/controllers/recording.controller.ts`

## 迭代约束

- interim 增量与最终已保存文本分开；不能用重写或删除标点伪造实时结果。
- 停止操作必须可重入，保留 completed/error 终态，并有界等待最终正文读取。
- 音频传输应聚合成稳定帧，停止时刷新尾帧；不要把 AudioWorklet quantum 当 WebSocket 帧。
- ASR 配置、供应商 receipt、分段时间范围和最终 transcript artifact 必须可追溯。

修改前先读 `transcription-core.ts`、ASR provider、recording controller 和实时转录测试。
