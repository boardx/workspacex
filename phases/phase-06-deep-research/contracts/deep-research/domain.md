# Domain — Deep Research

- `workflowType`: 固定为 `deep_research`。
- `sessionId`: 会话幂等与恢复主键。
- `chatThreadId`: 与聊天线程关联。
- `teamId`: 租户与权限边界。
- 启动入口参考 backend：`POST /api/v1/ai-agent/deep-research/session/start`。
- 参考 payload：`topic`、`goals`、`language`、`files`、`workflowType=deep_research`、`teamId`、`chatThreadId`、`userMessage`、`sessionId`。
- 节点：brief、directions、outline、research-plan、search、report。
- 当前 devapp UI 步骤：研究列表、创建研究、确认主题、研究方向、报告大纲、资料研究、研究报告。
