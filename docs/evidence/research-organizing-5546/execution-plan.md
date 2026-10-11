# 执行计划 — 报告首次生成与重新生成修复 #5546

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：首次和重新生成正常输出完整报告；无效引用丢弃，不阻断生成
- **完成判据**：完整四章/32题正式报告、正常刷新与重新生成历史；受影响测试/类型/lint/release通过，自动main PR并CI绿
- **不做什么**：仅#5546；保留语义支持性/深度/缺口门；独立基线依赖不混入本PR
- **假设与待确认**：同现有worktree/session；正常UI动作，无预审报告注入

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：完整报告正常输出])
  S1[1. 确认引用弃用与完整输出判据]
  S2[2. 定位实际失败链]
  S3[3. 修复与反证测试]
  S4[4. 完整UI重新生成与刷新历史]
  S5[5. 独立审核、main PR和CI绿]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: Immutable failed-v3/v4/v5/v6 metadata and exact-body diagnoses recorded in full-scope-repair.md
  class S3 tested
  %% evidence S3: API36/808; full research UI31/319; history integration red2 then35pass; API/Web types and lint exit0
  class S4 tested
  %% evidence S4: Full v10 4/32 formal, 38 calls306-343, 7 discarded citations; normal refresh and independent current/history UI acceptance
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-10T15:04Z | G, S1 | todo → doing | 接到目标，开始理解 |
