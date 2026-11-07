# 执行计划 — #6341 pptx

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：HTML 分支原先截断成300字单文本框；现在语义表格转换为原生表格，保留完整正文。
- **完成判据**：pnpm --filter web exec vitest run tests/ui/prototype-pptx-export.test.ts
- **不做什么**：仅上述清单；不更改其他并行任务文件
- **假设与待确认**：真实审计项目复测与独立 PR 由主会话执行

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

  class G tested
  %% evidence G: 见本目录handoff.md及RED/GREEN/浏览器日志
  class S1 tested
  %% evidence S1: 见本目录handoff.md及RED/GREEN/浏览器日志
  class S2 tested
  %% evidence S2: 见本目录handoff.md及RED/GREEN/浏览器日志
  class S3 tested
  %% evidence S3: 见本目录handoff.md及RED/GREEN/浏览器日志
  class S4 tested
  %% evidence S4: 见本目录handoff.md及RED/GREEN/浏览器日志
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-07 | G, S1 | todo → doing | 接到目标，开始理解 |
