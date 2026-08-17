# 用户访谈需求

## R1 模块独立
用户访谈是独立 phase。后续用户访谈新增能力、契约修订、UI 调整都在本阶段维护。

## R2 Backend 启动流程
用户访谈参考现有接口：

`POST https://backend.boardx.com.cn/api/v1/ai-agent/deep-research/session/start`

请求示例：

```json
{
  "topic": "江西赣州足球",
  "goals": [],
  "language": "zh-CN",
  "files": [],
  "workflowType": "user_research",
  "teamId": "6919cffaa098681a2df676f4",
  "chatThreadId": "6a827a9f05d38393a19718aa",
  "userMessage": "江西赣州足球",
  "sessionId": "6a827a9f42b1e05501ccbdc0"
}
```

## R3 主流程
用户输入访谈主题后创建或恢复用户研究会话；系统围绕访谈对象、研究问题、材料进度、访谈发现组织结果；用户可查看报告并追溯来源。

## R4 异常流程
未知 `workflowType`、缺少关键字段或跨 workflow 读取时返回可解释错误；部分节点失败时保留已完成访谈材料并允许重试。

## R5 展示方式
用户访谈展示以对象和问题为中心：访谈对象、问题清单、材料状态、发现聚类、用户研究报告。它复用启动流程，但显示方式不同于深度研究。
