---
bundle: chat-context-engine
phase: "01"
covers: []   # F 编号待拆入 feature_list 后回填；本束先行签核设计方向与参数
status: confirmed           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: yanbin shen
confirmed_at: 2026-08-11T14:30:00+08:00
confirmed_via: >-
  人类在 2026-08-11 的「Chat UI 体验迭代」会话里，看过 docs/proposals/PROP-CHAT-CONTEXT-ENGINE-001.md
  §4（V10 + 分层历史）后逐字回复「我看了，并且approve」；随后对推荐默认值逐字回复「yes to all」。
  另有主会话人类逐字指令「要把contextengine用上」（2026-08-11 晨）作为方向裁决的补强出处。
  由 coord-main 按 #660 先例代抄进本 frontmatter；人类可随时修改。
---

# 契约束 `chat-context-engine` 设计签核（V10 + 分层历史）

> 签核对象：`docs/proposals/PROP-CHAT-CONTEXT-ENGINE-001.md` §3.4/§4 + 分层历史设计
> + 下列人类确认参数。三件套材料由 dev-chat-e2e 随后补入，不一致以本文为准。

## 人类确认的参数（2026-08-11「yes to all」）

| 项 | 确认值 |
|---|---|
| 分层历史方向 | **L1 最近 ~15 轮原文 + L2 持久化滚动摘要（每轮增量更新，不重读全史）+ L3 检索** |
| `HISTORY_MAX_MESSAGES` | **不撑大行数上限**：L1 保持 ~15-20 条原文，更旧的交给 L2 滚动摘要（省成本） |
| L2 载体 | 新表 `thread_context_state`（持久化增量摘要，run 时直读） |
| L3 | 复用既有 context-pack/retrieval 引擎（五路召回、权限约束），接线不重写 |
| 个人对话 | **零召回**（无项目上下文如实呈现，不伪造；须有真栈反证） |
| 可审计快照 | `agent_run_context`（或 step jsonb 列）记录本次实际喂入结构 |

## 范围边界
- `ModelCallPort` 契约不动（coord-main 裁决 A 条件延续）
- V8 已合入部分（#913/#915 滚动摘要+观测）不在本束重复签核——本束签的是 L2 持久化、L3 接线与快照表
