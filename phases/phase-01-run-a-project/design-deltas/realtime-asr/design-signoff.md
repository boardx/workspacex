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

---

# 增补 A：输入设备（麦克风）选择（2026-08-12）

<!--
  这是对本已签束 §5 前端边界的**增补**，新增一个 UI 面（Microphone 下拉），
  规范见 contract.md §7。本增补独立签核：agent 不得改下面的 addendum_status。
  原束 frontmatter 的 status: confirmed 不受影响、未被本增补修改。
-->

addendum: input-device-selection
addendum_status: confirmed
addendum_confirmed_by: "usamshen"
addendum_confirmed_at: "2026-08-12T..+08:00"

## ① UI（新面）

composer 麦克风按钮旁一个设备下拉：列出所有 `audioinput` 设备，当前选中项打勾；
未授权麦克风时 label 不可读，显示占位而非空白（contract.md §7.3-1）。
**本增补只接 composer 听写入口**，会话录音面板不加 UI（§7.2）。

## ② 用例

- 选择某设备 → 下次开始听写用该设备采音（`getUserMedia` 加 `deviceId: { exact }`，§7.1）。
- 插拔设备 → 列表刷新（`devicechange`，§7.3-2）。
- 选择记忆到 localStorage；记的 id 若已不存在，退化为系统默认（§7.3-3）。

## ③ API 与持久化契约

**无后端改动。** 上行协议、`ingestSegment` 落库单路、机密 fail-closed 逐字不变（§7 抬头）。
纯采集端增强。

## 不做（本增补明确排除）

「Hold to record」按住说话开关（§7.4）——改的是 start/stop 交互语义，另立一条。

## 人类决定

<!-- 同意就把 addendum_status 改成 confirmed 并补 addendum_confirmed_by / _at。
     在那之前实现可在分支上写，但**不合入 main**。agent 不得代签。 -->

我确认。--usashen
