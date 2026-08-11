# 契约束 `chat-context-engine` — 领域模型与不变量（支撑材料）

> 洋葱最内层。覆盖 feature：见 `design-signoff.md` 的 `covers:`（权威）。
> 依据 UC：`08-chat/uc-8-7-上下文引擎分层历史.md`（全读）。架构：`PROP-CHAT-CONTEXT-ENGINE-001.md` §4.4。

## 实体 / 概念

- **分层历史**（喂给模型的上下文）三层：L1 近端原文（最近 ~N 轮逐字）+ L2 持久滚动摘要
  （旧轮压缩、每轮增量更新、不重读全史）+ L3 检索召回（按相关性召回更早/文件内容）。
- **`thread_context_state`**：持久化 L2 滚动摘要（每线程一份，随对话增量更新）。
- **`agent_run_context`**：可审计快照，记录本次 run 实际喂入的结构（L1 几轮 / L2 摘要 / L3 召回几条）。

## 不变量

1. **打破 20 条硬上限**：`HISTORY_MAX_MESSAGES=20` 使 100 轮对话前 80 轮对模型不存在；
   分层历史用 L2 滚动摘要 + L3 检索承载超出近端窗口的内容。
2. **端口内侧，`ModelCallPort` 契约不动**（人类裁决 A）：组装在 `ContextAssemblyPort` 内侧、
   `execute-run.ts` 调 model 之前；产出仍是 role+content 的 history，端口形状不变。
3. **权限约束检索**：L3 召回受 actor 可见范围约束；**个人对话无项目 ⇒ 零召回**（不伪造，F155 反证）。
4. **失败降级不 fail run**：摘要/检索失败 ⇒ 退回更简的历史组装，不把能跑的 run 拖失败
   （同 #709 历史读取失败降级、V8 摘要失败降级）。

## 三、③ 件为什么**不是** zod 契约文件（无对外 HTTP 面）

本束**没有对外 HTTP 端点**。上下文组装完全发生在 `execute-run.ts` 的端口内侧（application 层），
是 chat 发消息触发 agent run 时的**内部行为**，不新增任何 `POST/GET` 操作，`ModelCallPort` 契约
也不动。因此 ADR-023 第 ③ 件走**形态 B（显式声明无 HTTP 面）**，而不是形态 A（zod 契约文件）——
「忘了写契约」和「本来就没有 HTTP 面」在磁盘上必须长得不一样，这一节就是那个显式声明。
门控命令见 `coverage.md` 的「API 操作」列。
