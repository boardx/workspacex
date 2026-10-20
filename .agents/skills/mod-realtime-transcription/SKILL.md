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
- 2026-09-24：个人实时转录的输入设备与电平反馈应复用全站麦克风选择和 PCM RMS 单一事实源；设备选择只在开始采音时生效，录音/收尾期间锁定（出处：issue #4090）。
- 2026-09-24：实时转录必须等 provider `ready` 后才启动采音，并把浏览器、provider 启动期和上游发送缓冲限制在约 1 秒；超过上限显式报 `AUDIO_BACKPRESSURE`，不得用无界队列把故障伪装成延迟（出处：issue #4099）。
- 2026-09-28：访谈需求的实时 ASR 临时文本只投影到主输入框，不写入 canonical Markdown；停止后确认文本恰好追加一次，取消录音恢复原文，异常完成时由用户显式保留或丢弃（issue #4539，`interview-voice-input` 回归）。

- 2026-09-30：个人转录重连采用有限退避，离线暂停、稳定连接后重置预算；停止/离页取消启动并隔离旧回调，重连前读回持久化正文，断线音频缺口不能隐藏（issue #4750，`realtime-reconnect` 与 `realtime-transcription-history` 回归）。

## 知识回流规则

- 2026-10-04：项目转录的面板导航必须保留 `mode=project`、载体、视角与项目参数，只替换 `screen`；丢失 mode 会进入个人历史页。两个「去校对」出口均经真实 IAB 点击复测；项目示意控件不能算作真实 ASR、播放或持久化验收（issue #5258，`rec-review-navigation` 回归）。

- 2026-10-01：访谈语音输入对临时 ASR 故障启用有限重连，确认文本跨连接保留、临时文本不重放；启动取消信号在取得录音句柄后必须解绑，已连接流仍通过 `stop()` 刷新尾帧，避免离页收尾退化为硬断线（issue #4801，`asr-draft-reconnect` / `asr-draft-cleanup` 回归）。

谁修改本模块，谁在 PR 中追加一条可验证经验；不删除旧条目，推翻时标明替代来源。

- 2026-10-04：ASR gateway 测试须完整断言服务器计量身份，并在 afterEach 无条件清理客户端与 gateway WebSocket；仅末尾 close 会在身份断言失败后使 HTTP server.close 等待至超时（issue #5261 / PR #5269，故意不匹配本地断言 1.39s 退出反证）。

- 2026-10-15：个人录音 VAD 模式停止使用 `session.finish` 并等待 `session.finished`，不能发仅适用于 manual 的 commit，也不能以已有 final 替代结束回执；录音断句窗口与 chat 隔离，保留原始标点。尾帧和 tracks 释放后 AudioContext.close 竞态不应阻断服务端停止握手（issue #5742，recording-protocol 与 pcm-audio-worklet-stop 回归）。

- 2026-10-15：个人转录界面展示调整限定 rec 局部，移除重复创建卡仍保留顶部入口；创建仅进入工作区，不应文案暗示已启动采音。停止/恢复/改名以现有43项交互回归保护（issue #5753）。

- 2026-10-15：紧凑转录展示复用共享WorkflowActionButton/Bar；loading只绑定真实执行，connecting的取消不可随busy禁用。正文保存pending须阻止重复提交；隔离真实路由应走登录/持久化读回，布局fixture不代替应用壳验收（issue #5762，45项交互回归）。

- 2026-10-16：逐字稿内联改名与编辑退出需恢复到仍连接且可用的入口，编辑框应有可访问名称；保存拒绝须在UI捕获并保留草稿/重试，不能只靠父层banner而留未捕获Promise。长连续标识用展示换行保护原文，不改存储文本（issue #5778，四轮真实隔离路径与断网复验）。

- 2026-10-20：转录返回可用性依本地采音/收尾与编辑草稿判断，不能把服务端遗留 recording 当成本地锁；编辑/保存需有明确退出说明，清筛选/重载只在用户触发时恢复搜索焦点，异步刷新不得抢焦。真实隔离浏览器覆盖草稿、pending 与恢复反证（issue #5842）。
