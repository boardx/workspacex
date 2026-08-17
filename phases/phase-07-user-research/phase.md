# Phase 07 — 用户访谈

- **slug**: user-research
- **状态**: not_started
- **创建于**: 2026-08-17

## 目标
独立维护用户访谈模块，参考 backend `POST /api/v1/ai-agent/deep-research/session/start` 的真实调用流程，以 `workflowType=user_research` 启动访谈研究。

## 边界
- 做：访谈研究会话启动、对象/问题组织、材料进度、访谈发现、用户研究报告。
- 不做：深度研究报告展示、数字专家访谈既有 phase、转录、问卷。

## 权威功能清单
本阶段唯一权威功能来源是同目录 `feature_list.json`。
