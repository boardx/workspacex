# `stage-aggregation` — 用例接口与失败模式

## 端口（草案，签核通过后落进 `packages/contracts/src/live-collab-stage-aggregation.ts`）

| 端口 | 输入 | 输出 | 说明 |
|---|---|---|---|
| `getKanbanBoard` | `projectId` | `{ ready: false, blockedBy: "phase-02" }`（本轮只能是空壳） | 真实看板卡片字段由 phase-02 F02 对应契约束定义，本端口目前只声明"未就绪" |
| `getDecisionGraph` | `projectId` | `{ ready: false, blockedBy: "phase-02" }`（本轮只能是空壳） | 真实决策树节点字段由 phase-02 F11/F15/F16 对应契约束定义 |
| `broadcastToGroupLeads`（**不依赖 phase-02，可能可独立开工**） | `projectId`, `message` | `{ sentAt, visibleToAllGroups: true }` | 触发通知动作，不读取 phase-02 领域数据 |
| `dispatchNextWork`（**不依赖 phase-02 数据本体，但依赖 phase-02 F17 的"下一步可开展的工作"定义**） | `projectId`, `workItemId`, `targetGroupId` | `{ dispatched: true }` | 派发动作本身可独立设计，但"工作项"从哪来仍需 phase-02 F17 |

## 失败模式

| 场景 | 错误码（草案） | 前端表现 |
|---|---|---|
| phase-02 看板束/知识图谱束尚未签核（当前实况） | `UPSTREAM_BUNDLE_NOT_SIGNED`（草案） | `dep-failed` 态（见 `stage-kanban-dep-failed.png`） |
| 非引导师访问看板/知识图谱聚合视图 | 沿用 `viewer-role` 束的 `VIEWER_SCOPE_DENIED`（不重复定义） | `denied` 态 |
| 广播动作调用成功 | 无错误 | `saved`/成功态（见 `stage-kanban-success.png`） |

## 签核前请重点确认

- [ ] **`getKanbanBoard`/`getDecisionGraph` 的"未就绪"响应形状是否要标准化**——如果本 phase
      未来还有其它 feature 遇到同样的"消费另一个 not_started phase"情况，这个 `{ready, blockedBy}`
      形状是否应该抽成一个跨 phase 的通用约定，而不是本束自己定义一次。
- [ ] **`broadcastToGroupLeads`/`dispatchNextWork` 能否与看板/图谱数据本体解耦先行开工**——
      这是本束用例设计里唯一可能绕开硬阻断的口子，签核时请明确是否认可这个拆分思路。
