# 深度研究需求

## R1 模块独立
深度研究是独立 phase。后续深度研究新增能力、契约修订、UI 调整都在本阶段维护。

## R2 Backend 启动流程
深度研究参考现有接口：

`POST https://backend.boardx.com.cn/api/v1/ai-agent/deep-research/session/start`

请求示例：

```json
{
  "topic": "撒打算",
  "goals": [],
  "language": "zh-CN",
  "files": [],
  "workflowType": "deep_research",
  "teamId": "6919cffaa098681a2df676f4",
  "chatThreadId": "6a8286b771fc233fc54c4f0b",
  "userMessage": "撒打算",
  "sessionId": "6a8286b77009bb4e06e0bb96"
}
```

## R3 主流程
用户输入主题后创建或恢复研究会话；系统生成研究 brief、研究方向、报告大纲；用户可确认或编辑每一步；确认后系统按大纲执行搜索并生成带 citations 的完整报告。

## R4 异常流程
缺少 `workflowType`、`sessionId`、`teamId` 或未知 `workflowType` 时拒绝启动并返回可解释错误；节点执行失败时保留已完成节点，用户可继续、重试或返回历史列表。

## R5 展示方式
深度研究展示以报告生产为中心：研究方向、报告大纲、章节搜索进度、来源引用、完整报告和恢复状态。
