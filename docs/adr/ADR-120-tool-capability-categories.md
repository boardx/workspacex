# ADR-120: 工具能力分类与官方 Agent 的工具策略

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
MCP 工具目前只按 `sideEffect` 区分，没有能力分类，也没有健康探测。Agent starter-pack 的契约和 DB CHECK 都强制 `tool_policy` 为空，带工具的角色 Agent 无法经包分发。

## 决策
1. MCP 工具增加 `capabilityCategory`（如 `crm.read`、`crm.write`、`mail.send`）；Skill 依赖、Workflow 阶段、Agent 工具策略都写分类，不写具体供应商。
2. 放宽 starter-pack 的 `toolPolicy`：允许声明**能力分类**，不允许携带授权或凭证；实际授权由组织管理员给，默认只读，**不继承写权限**。
3. 权限被拒后，不得用同分类的其他供应商静默重试。
4. 健康探测按 `service-uptime-poll-worker` 的模式实现。

## 后果
- 官方 Agent 可以随包分发，但导入后在组织授权前只能做只读工作。
