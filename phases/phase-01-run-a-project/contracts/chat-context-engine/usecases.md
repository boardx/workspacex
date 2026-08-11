# 契约束 `chat-context-engine` — ② 用例接口（application 层端口）

> 洋葱中层。**无对外 HTTP 面**（见 domain.md 第三节）——这里定义的是**端口内侧**的组装用例，
> 由 `execute-run.ts` 调用，不是 HTTP 操作。覆盖 feature：`design-signoff.md` `covers:`（权威）。
> 依据 UC：`08-chat/uc-8-7`（R8/R12）。

## UC1 · 分层组装（F154）
run 组装上下文时：读近端 N 轮原文（L1）+ 读/更新 `thread_context_state` 的持久滚动摘要（L2，
增量、不重读全史）→ 合成 history。打破 `HISTORY_MAX_MESSAGES=20`。失败降级：摘要失败退回 V8
的丢弃行为，不 fail run。

## UC2 · L3 检索召回接线（F155）
组装窗口内可选调 context-pack/retrieval 引擎（复用既有 `application/context-pack/*`+`retrieval/*`，
**不重写**），按本轮 query + actor 可见范围召回片段，作为 role+content 伪消息注入。`ModelCallPort` 不动。

## UC3 · 个人对话零召回（F156）
个人对话无项目上下文 ⇒ L3 不召回（真栈反证 `retrieval_requests==0`，不伪造注入）。

## UC4 · 可审计快照（F157）
每次 run 落 `agent_run_context`：本次实际喂入了 L1 几轮 / L2 摘要 / L3 召回几条——让「这次到底
喂了什么」可审计（现状只存 sha256 digest）。

## 失败面
摘要模型调用失败 / 检索引擎不可用 / 快照落库失败——**一律降级不 fail run**（保守失败模式）。
