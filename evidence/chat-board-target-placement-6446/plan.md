# 执行计划 — 聊天画布选择 Board 与位置预览

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：将聊天生成的图表/模板插入所选项目或组织 Board，预览位置并确认持久化。
- **完成判据**：相关 UI/API/core 测试、全栈浏览器取消/拖动/确认/打开/刷新、typecheck/lint 与 PR 检查通过。
- **不做什么**：不改 Board 权限模型，不写 Fabric JSON，不做生产发布。
- **假设与待确认**：组织场景复用现有组织 Board 库；项目场景仅列已关联 Board。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：确认插入并持久化])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 实现最小改动]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：PR / 交接]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 done
  class S3 done
  class S4 tested
  %% evidence S4: UI73 + final handoff17/focus7, API28, core11, serializer67, static35; fullstack actual Fabric viewport checks passed
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-09 | G, S1 | todo → doing | 接到目标，开始理解 |
