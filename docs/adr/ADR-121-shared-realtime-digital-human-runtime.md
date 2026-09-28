# ADR-121: 实时数字人共享运行时

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
v2 `realtime-digital-human/` 要求 60 个角色都能实时语音交互（转写、判断说完、打断、头像、看到工作区上下文）。按角色各做一套会产生 60 份重复实现和第二套 agent 平台。

## 决策
1. 只建**一个共享的实时运行时**作为呈现层，挂在现有 Agent / Harness 之上；角色只贡献配置（语音风格、头像说明、轮次/主动发言策略、模态、记忆范围、角色评测）。
2. 实时运行时**不得**绕过 Agent Skill Pins、Workflow 白名单、HITL 和授权；会话模型只能「请求」Skill/Workflow。
3. 作为独立 phase 轨道推进，依赖 ADR-116 的 Agent 扩展字段；试点角色与 Stage 1 一致（D002 / D003 / D005）。
4. ASR/TTS/媒体/头像渲染走供应商无关的端口，复用 `ConfiguredRealtimeAsrProvider` / `AsrProviderPort` 与 `domain/chat/proactive-speech.ts`。

## 后果
- 角色文档只写实时语义，不写供应商 SDK。
- 云 / 混合 / 私有化部署只换适配器，不改角色规格。
