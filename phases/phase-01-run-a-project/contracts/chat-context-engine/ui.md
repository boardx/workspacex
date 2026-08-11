# 契约束 `chat-context-engine` — ① UI

> **UI material reuse: no new screen; reuse_bundle: `chat`.**
>
> **自检**：本文件引用 20 张截图（复用 `chat` 束的 `ui-preview/chat-v2/`），该目录实际 20 张 PNG。
> N == M == 20，逐张核对全部真实存在，无死链。
> 复核命令（唯一实现）：`node .harness/scripts/lint-ui-material.mjs`

context-engine 是**后端/上下文能力，没有独立用户界面**。它的用户可见面**寄生在 chat 屏**
（多轮记忆、文件内容进上下文后 agent 能引用），没有专属屏。按 `lint-ui-material` 的复用机制
声明复用 `chat` 束（`.harness/scripts/ui-material-map.json` 里本束映射为 `{ "reuse_bundle": "chat" }`，
先例=curated-capability-packs 复用 skills）。复用机制要求本文逐张引用被复用目录的截图集合：

覆盖 feature：见 `design-signoff.md` 的 `covers:`（权威，F154–F157）。

## 复用的截图集合（`ui-preview/chat-v2/`，逐张）

| # | 截图 |
|---|---|
| 1 | `ui-preview/chat-v2/uc-8-3-landing-default.png` |
| 2 | `ui-preview/chat-v2/uc-8-3-landing-denied.png` |
| 3 | `ui-preview/chat-v2/uc-8-3-landing-dep-failed.png` |
| 4 | `ui-preview/chat-v2/uc-8-3-landing-empty.png` |
| 5 | `ui-preview/chat-v2/uc-8-3-landing-invalid.png` |
| 6 | `ui-preview/chat-v2/uc-8-3-landing-loading.png` |
| 7 | `ui-preview/chat-v2/uc-8-3-landing-nosource-gate.png` |
| 8 | `ui-preview/chat-v2/uc-8-3-landing-observer.png` |
| 9 | `ui-preview/chat-v2/uc-8-3-landing-success.png` |
| 10 | `ui-preview/chat-v2/uc-8-4-preset-consumer-member.png` |
| 11 | `ui-preview/chat-v2/uc-8-4-preset-consumer-observer.png` |
| 12 | `ui-preview/chat-v2/uc-8-4-preset-default.png` |
| 13 | `ui-preview/chat-v2/uc-8-4-preset-denied.png` |
| 14 | `ui-preview/chat-v2/uc-8-4-preset-dep-failed.png` |
| 15 | `ui-preview/chat-v2/uc-8-4-preset-editor.png` |
| 16 | `ui-preview/chat-v2/uc-8-4-preset-empty.png` |
| 17 | `ui-preview/chat-v2/uc-8-4-preset-invalid.png` |
| 18 | `ui-preview/chat-v2/uc-8-4-preset-loading.png` |
| 19 | `ui-preview/chat-v2/uc-8-4-preset-scope-violation.png` |
| 20 | `ui-preview/chat-v2/uc-8-4-preset-success.png` |
