---
name: mod-realtime-transcription
description: 实时录音、ASR 流式转录、停止收尾和逐字稿持久化；修改录音或实时转录时使用。
---

# 实时转录模块

负责浏览器录音、音频分段、ASR provider、实时增量、停止收尾和最终逐字稿。

## 代码地图

- 前端：`apps/web/app/rec`、`apps/web/components/itv/live-record.tsx`、`apps/web/lib/live-personal-transcriptions.ts`、`apps/web/lib/live-recording.ts`
- API：`apps/api/src/application/recording`、`apps/api/src/domain/recording`、`apps/api/src/infrastructure/recording`
- 控制器：`apps/api/src/interface/controllers/recording.controller.ts`

## 迭代约束

- interim 增量与最终已保存文本分开；不能用重写或删除标点伪造实时结果。
- 停止操作必须可重入，保留 completed/error 终态，并有界等待最终正文读取。
- 音频传输应聚合成稳定帧，停止时刷新尾帧；不要把 AudioWorklet quantum 当 WebSocket 帧。
- ASR 配置、供应商 receipt、分段时间范围和最终 transcript artifact 必须可追溯。

修改前先读 `transcription-core.ts`、ASR provider、recording controller 和实时转录测试。

## 模块 SOP

1. 先读本文件和对应 feature 的行为/验证契约；录音与转录改动跑 recording、transcription 和受影响端到端测试。
2. 在独立 worktree 中实现；涉及音频、隐私或 ASR 外发时补安全审查。
3. PR 中记录终态、receipt、分段和最终文本的验证证据。

## 踩坑与经验（append-only）

- 2026-09-19：停止收尾必须复用停止 Promise 并有界读取最终正文，读取失败不能反转 ASR 已完成状态（出处：issue #3743）。

## 知识回流规则

谁修改本模块，谁在 PR 中追加一条可验证经验；不删除旧条目，推翻时标明替代来源。
