# 执行计划 — 核心 UIUX ad-hoc 修复

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：基于最新 main 修复浏览器发现的一致性 Gap 并提交 PR
- **完成判据**：浏览器证据、受影响测试、typecheck/lint 通过，PR CI 通过
- **不做什么**：不修改他人共享工作树改动，不修改模型/权限契约
- **假设与待确认**：十轮为专项走查，不声称穷尽问题或达到独立评分9分

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：一句话目标])
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

  %% evidence S1: report.md 目标与范围
  %% evidence S2: latest/ 浏览器截图
  %% evidence S3: report.md 逐轮修复
  %% evidence S4: validation.txt
  class G doing
  class S1 tested
  class S2 tested
  class S3 tested
  class S4 tested
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-09-30 | G, S1 | todo → doing | 接到目标，开始理解 |
