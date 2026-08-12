# 引导式 Deep Research · contract delta

Status: proposed; human signoff required.

本文件定义 UC-24.6 的增量边界。最终 schema 必须追加到
`packages/contracts/src/research.ts`，Web 与 API 不得各自声明一份相似类型。

## 1. 状态机

```text
brief → directions → outline → researching → report
  │         │           │           │          │
  └─────────┴───────────┴───────────┴──────────┴─ failed（保留上一稳定快照，可重试）
```

终端状态只有 `report`。`failed` 不是清空状态，必须携带 `resumeStage` 与最近稳定数据。

## 2. 聚合模型

`GuidedResearchSession`：

- `id / researchId / ownerId / stage / status / updatedAt`
- `brief`：topic / goal / timeRange / region / focus
- `directions[]`：id / title / description / enabled / order
- `outline[]`：id / title / questions[] / enabled / order
- `progress`：percent / currentQuery / sourceCount / tasks[] / latestSources[]
- `reportId`：只在 report 阶段非空
- `lastError`：失败原因与可重试阶段；不得携带上游 secret 或内部 URL

`ResearchReport`：

- `id / sessionId / title / generatedAt / readMinutes / sourceCount`
- `sections[]`：稳定 section id / title / body / citationIds[]
- `citations[]`：稳定 id / title / canonicalUrl / domain / sourceKind / retrievedAt

## 3. 拟议操作

| 操作 | 方法与路径 | 用途 |
|---|---|---|
| `listGuidedResearchSessions` | `GET /research/guided-sessions` | 首页历史列表；服务端返回 resumeStage |
| `createGuidedResearchSession` | `POST /research/guided-sessions` | 保存 brief，进入 directions |
| `getGuidedResearchSession` | `GET /research/guided-sessions/:sessionId` | 刷新、恢复与轮询快照 |
| `generateResearchDirections` | `POST …/:sessionId/directions/generate` | 从 brief 生成方向；不自动确认 |
| `saveResearchDirections` | `PUT …/:sessionId/directions` | 保存人类编辑版本，进入 outline |
| `generateResearchOutline` | `POST …/:sessionId/outline/generate` | 从已保存方向生成大纲 |
| `saveResearchOutline` | `PUT …/:sessionId/outline` | 保存人类编辑版本 |
| `startGuidedResearch` | `POST …/:sessionId/start` | 冻结本次大纲版本，开始后台搜索 |
| `retryGuidedResearchStage` | `POST …/:sessionId/retry` | 仅重试失败阶段，已完成来源不清空 |
| `getGuidedResearchReport` | `GET …/:sessionId/report` | 读取结构化报告与 citations |

## 4. 不变量

1. 首页 `resumeStage` 由服务端状态派生，客户端不自行推进。
2. directions / outline 都带版本号；生成新版本不覆盖最近一次人类确认版。
3. `startGuidedResearch` 幂等：同一 session + outlineVersion 重放不得启动第二次搜索。
4. 来源按 session + canonical URL 去重，但不同 retrievedAt 的快照可保留 provenance。
5. 单任务失败是部分失败；其它任务结果与来源仍可读。
6. report 章节只引用存在于 `citations[]` 的 id，孤儿引用是契约错误。
7. 观察者与无权用户的数据在 API 层过滤/拒绝，不能只在 UI 隐藏。

## 5. 参考实现映射

- `boardx-web` 的 session recovery、editable plan、polling/SSE、reference viewer 提供交互参考。
- `boardx-backend` 的 session start/interact/recover/status/report 提供生命周期参考。
- 本仓不直接复制其 DTO；字段先收敛到本仓既有 `Research` / provenance / artifact 契约。
