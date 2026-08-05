---
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-08-05T11:20:00+08:00"
bundle: realtime-asr
scope: browser-capture-server-proxied-realtime-asr-into-chat
---

# Realtime ASR 设计签核（#466 步骤 7）

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `recording` / `chat` /
`agent-runtime` 束。本文件的每一次 status 变更都归人类所有——**agent 不得改 status**
（ADR-023）。

规范来源：[contract.md](./contract.md)。

## ① UI

见 [contract.md §5](./contract.md#5-前端边界)。

要确认的：chat 会话内的录音入口与四个锚点；三种真实失败态（权限被拒 / 无麦克风 /
转写失败）在界面上说人话，不静默。

## ② 用例与依赖顺序

见 [contract.md §1–§2](./contract.md#1-ws-面)。

要确认的：**落库只有一条路**——`asr.final` 由服务端调既有 `ingestSegment`，
客户端不自己写。幂等沿用既有键，重连重放不产生第二条。

## ③ API 与持久化契约

见 [contract.md §1、§3、§4](./contract.md#1-ws-面)。

要确认的三件，任何一件不同意就不要签：

1. **新增本仓第一条 WebSocket 契约面**（`WS /recording/sessions/:sessionId/asr-stream`）。
   现有契约是 `{method, path}` 形状，装不下 WS；签这份即同时确认「WS 面如何在契约里表达」。
2. **录音音频会离开本地边界**，送到阿里云 Qwen3-ASR-Flash-Realtime。这是实质变化，
   不是实现细节。
3. **机密数据域 fail-closed 拒绝**（`CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR`），
   且**不提供任何"确认后继续"的绕行开关**。要放宽得改 D-U1 本身，那是另一次签核。

## 可执行验收契约

见 [verification.md](./verification.md)。

## 人类决定

<!-- 人类在此写下确认语；确认后把上面的 status 改成 confirmed 并补 confirmed_by /
     confirmed_at。在那之前任何实现 PR 都不该被合并。 -->

待确认。
