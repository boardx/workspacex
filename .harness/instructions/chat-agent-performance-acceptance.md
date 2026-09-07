# Chat Agent 性能验收标准

> 适用于 `/chat` 的发送、流式回复、Thinking/Tool/Skill 轨迹、HITL、刷新恢复与画布呈现。
> 性能验收和功能验收同时通过，才允许交付相关体验改动。

## 两层门控

1. **PR 硬门控**：固定 loopback 剧本、固定分片间隔、`workers=1`，每个场景预热后执行
   3 次。任一次超过硬上限、出现页面错误或数据重复，PR 失败。
2. **定时基线**：同一版本每个场景至少收集 30 个有效样本，发布 p50/p95 趋势；少于
   20 个样本不得发布 p95。真实模型只进入趋势观测，不作为 PR 延迟门控。

## 用户体验 SLO

| 路径 | 起点 → 终点 | p50 | p95 | PR 硬上限 |
|---|---|---:|---:|---:|
| 发送即时反馈 | 点击发送 → 蝴蝶或运行态首次绘制 | 250 ms | 600 ms | 1.2 s |
| 首个流式正文 | 点击发送 → assistant 正文首次非空 | 800 ms | 1.5 s | 3 s |
| 流式连续性 | 首次非空 → 第 4 个不同长度样本 | 500 ms | 1.2 s | 2 s |
| HITL 出现 | 点击发送 → Generative UI 对话框绘制 | 2 s | 5 s | 8 s |
| HITL 继续 | 提交决定 → 对话框消失且原 run 恢复活动 | 500 ms | 1.2 s | 2.5 s |
| HITL 刷新恢复 | `DOMContentLoaded` → 同一请求对话框恢复 | 800 ms | 2 s | 4 s |
| 运行中刷新恢复 | `DOMContentLoaded` → 权威状态及轨迹可见 | 1.2 s | 3 s | 5 s |
| 终态刷新恢复 | `DOMContentLoaded` → 最终消息及折叠轨迹可见 | 1.5 s | 3.5 s | 6 s |
| 工具事件呈现 | journal `emittedAt` → 对应轨迹行绘制 | 150 ms | 500 ms | 1 s |
| 轨迹展开 | 点击折叠条 → 首条轨迹可见 | 100 ms | 300 ms | 600 ms |
| 100 条轨迹稳定 | 最后事件到达 → 100 条唯一记录稳定 | 400 ms | 900 ms | 1.5 s |
| 画布内嵌渲染 | Mermaid 正文入 DOM → Fabric 画布可见 | 300 ms | 900 ms | 2 s |
| 画布放大 | 点击最大化 → 画布可交互 | 150 ms | 500 ms | 1 s |
| 画布刷新读回 | `DOMContentLoaded` → 已保存画布可交互 | 1 s | 2.5 s | 5 s |

## 采集契约

- 点击前用浏览器 `performance.mark()` 记录起点；用 `MutationObserver` 记录运行态、正文、
  HITL、轨迹和画布的真实 DOM 提交时间，避免 Playwright 轮询造成测量偏差。
- 通过 `runId / attemptId / toolCallId / permissionRequestId` 关联浏览器样本、持久 journal
  和服务端结构化日志。刷新后必须恢复相同的 `permissionRequestId`，创建新请求即失败。
- 流式正文至少产生 4 个不同长度样本，长度单调不减，单次增长不得超过总长度的 60%。
- 实时流与回放的 `toolCallId` 必须唯一且数量一致；100 条轨迹不得丢失、乱序或重复。
- 画布验收同时要求无 `pageerror`、无 React key/重复挂载错误，节点数量稳定。
- 发送后发生的超时、断流、页面错误都计为失败。只有发送动作前服务尚未就绪的样本可以
  作废；同轮控制请求 p95 比基线恶化超过 50% 时只允许重跑一次。

## 固定测试环境与证据

- 预热 `/api/copilotkit/info`、目标 `/chat/[threadId]` 和画布动态 chunk；cold start 单独记录。
- loopback 固定回复大小、8 字符分片、80 ms 分片间隔和工具数量，测试之间不得修改剧本。
- 每次运行保存原始样本 JSON、Playwright trace、journal、服务端日志、commit SHA 和机器负载；
  聚合结果不能替代原始证据。
- PR lane 扩展 `copilotkit-v2-stream-frame-timing.spec.ts`、HITL/恢复/工具/画布现有 E2E；
  定时 lane 使用相同观测器重复采样，避免形成第二套指标定义。

