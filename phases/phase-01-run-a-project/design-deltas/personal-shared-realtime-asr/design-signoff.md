---
status: confirmed
bundle: personal-shared-realtime-asr
base_bundle: personal-realtime-transcription
scope: personal-rec-reuses-chat-configured-realtime-asr-provider
covers: [F173, F174]
confirmed_by: "qq13613030605"
confirmed_at: "2026-08-13T18:20:00+08:00"
---

# Design delta 签核 · `/rec` 复用 Chat 实时 ASR Provider

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已确认的 `personal-realtime-transcription` 束，只替换其中的上游 Provider 与配置来源。基础束保留为 2026-08-11 对 Fun-ASR 方案的历史签核，不被静默改写。

## ① UI

无新页面、布局或交互。继续复用基础束 [ui.md](../../contracts/personal-realtime-transcription/ui.md) 的历史卡片、创建弹窗、单一开始/停止按钮、连续正文、复制和编辑。

需要确认：未配置或 Provider 失败仍走既有可见错误态，不增加 mock/fallback，也不把 Qwen 原始事件暴露给浏览器。

## ② 用例

请评审 [`uc-5-6-个人转录复用-chat-实时-asr-provider.md`](../../requirements/05-rec/uc-5-6-个人转录复用-chat-实时-asr-provider.md)。

核心取舍：共享的是 Chat 已在使用的 Provider 实例与 `KERNEL_ASR_*`；个人 ticket、owner/org 鉴权、capture、BoardX WS 和正文持久化仍独立。

## ③ API 契约

请评审 [contract.md](./contract.md)。外部 HTTP/WS shape 和 BoardX server events 不变；变化只发生在服务端 application port、Provider 生命周期和用量来源。

重点确认：

1. 个人路径不再读取 `ALIYUN_ASR_*` / 独立 `DASHSCOPE_API_KEY`；
2. final 仍先落库后推送，interim 永不落库；
3. Qwen 未提供 Fun-ASR duration 时，以服务端 PCM 字节数计时且幂等；
4. 不保留 Fun-ASR fallback，避免部署状态再次分叉。

## 人类决定

已确认以上 UI、用例与 API 契约设计。

F174 是同一停止语义的回归修复：不增加界面、用例或外部协议，只纠正“已有 final 且无新尾段”被误判为收尾超时的问题。
