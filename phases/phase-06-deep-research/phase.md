# Phase 06 — 深度研究

- **slug**: deep-research
- **状态**: not_started
- **创建于**: 2026-08-17

## 目标
独立维护深度研究模块，参考 backend `POST /api/v1/ai-agent/deep-research/session/start` 的真实调用流程，以 `workflowType=deep_research` 启动和恢复研究会话。

## 边界
- 做：研究会话启动、历史恢复、研究方向确认、报告大纲确认、搜索执行、引用与完整报告。
- 不做：用户访谈展示、转录、问卷、第二套身份/Artifact/权限模型。

## 权威功能清单
本阶段唯一权威功能来源是同目录 `feature_list.json`。
