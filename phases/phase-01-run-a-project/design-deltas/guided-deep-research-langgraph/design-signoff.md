---
bundle: guided-deep-research-langgraph
base_bundle: research
scope: persisted-five-node-langgraph-workflow
covers: [F195, F196, F197, F198, F170, F171]
status: confirmed
confirmed_by: shenyangjun
confirmed_at: 2026-08-13T02:43:32+08:00
---

# Design delta 签核 · Guided Research LangGraph 五节点工作流

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已确认的 `research` 束，替代 F170/F171 尚未开工的演示执行边界，并新增 F195–F198
基础链。权威设计是
[`docs/superpowers/specs/2026-08-15-guided-research-langgraph-persistence-design.md`](../../../../docs/superpowers/specs/2026-08-15-guided-research-langgraph-persistence-design.md)。

## ① UI

请确认 [ui.md](./ui.md)：研究步骤位于单一 `/research?session=` 页面，切换节点不刷新；Skill 助手固定在
左侧约三分之一，步骤与完整报告在右侧约三分之二。恢复、锁定、失败、重试和 stale 状态均来自服务端
workflow projection，不读取 `flow=` 或 localStorage 推断。

## ② 用例

请确认 UC-24.6 的 R12–R13：五节点完整输入、上游重确认失效规则、显式模型调用边界、固定
`qwen3.7-plus`、strict structured output，以及独立 Web Search 证据链。

## ③ API 契约

请确认 [contract.md](./contract.md)：浏览器只提交公开完整 node input；Graph State/NodeMeta、租户身份、
checkpoint 和模型身份由服务端拥有；Python Graph 服务是唯一编排运行时，NestJS 只做鉴权、契约、receipt、
effect 与查询投影。相同 requestId 的 pending 重放必须恢复执行，只有 finalized receipt 可以直接返回。

## 阶段一致性复核输入

请一并确认 [coherence-addendum.md](./coherence-addendum.md)。本增量不新增 base bundle，但会触碰 research、
agent-runtime、skills、files/artifact 的边界；确认时需明确这些边界无冲突，并刷新 phase coherence 的人类确认。

## 人类决定

已确认。人类于本任务明确回复“已签核”；frontmatter 的签名与时间由人类填写，本段只同步叙述记录。
