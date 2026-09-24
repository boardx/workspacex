# Domain — Deep Research

- `workflowType`: 固定为 `deep_research`。
- `sessionId`: 会话幂等与恢复主键。
- `chatThreadId`: 与聊天线程关联。
- `teamId`: 租户与权限边界。
- 流程实现参考 `/Users/shenyangjun/boardx/boardx-backend`。
- 启动入口参考 backend：`POST /api/v1/ai-agent/deep-research/session/start`。
- 参考 payload：`topic`、`goals`、`language`、`files`、`workflowType=deep_research`、`teamId`、`chatThreadId`、`userMessage`、`sessionId`。
- 节点：brief、directions、outline、research-plan、search、report。
- 当前 devapp UI 步骤：研究列表、创建研究、确认主题、研究方向、报告大纲、资料研究、研究报告。
- 研究报告页必须支持查看完整报告、追溯来源与引用，并提供 PDF 与 Word/DOCX 导出。
- `effortTier`: 检索前由用户选择 `fast | std | deep`；浏览器只提交档位，不提交额度或用量。
- `budgetSnapshot`: 由服务端策略解析并随研究 runtime 持久化；快照含策略标识与版本、解析时间、各资源上限和并发数，创建后不可变。
- `budgetUsage`: 只由服务端在真实模型调用、任务规划、检索尝试、来源接纳与活跃执行边界累计；刷新、恢复和幂等重放不得重置或重复扣账。
- 预算缺失、已配置或耗尽分别返回稳定、可解释的领域错误；耗尽检查发生在下一次外部调用之前，不自动升级档位。
