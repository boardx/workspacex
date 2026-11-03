# 执行计划 — My workflow runs localization — #6169

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Localize /workflows/runs and shared navigation, retaining raw data and request behavior.
- **完成判据**：Locale/no-refetch/value/error/role regressions, legacy helper tests, real persisted read-only browser 375/1280, exact review, normal push and final CI.
- **不做什么**：Approvals, execution/start/grant logic, details, output and board remain separate.
- **假设与待确认**：Reuse approved dictionaries/provider. Built-in names by structured key only; fallback/user values remain original. Numeric local timestamp format stays unchanged.

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([Localize My runs])
  S1[1. Scope real list and copy sources]
  S2[2. Red state/value tests]
  S3[3. Typed copy and compatible helpers]
  S4[4. Real read-only browser and regressions]
  S5[5. Exact review PR and final CI]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: /tmp/i18n-workflow-runs-red.log: 4 red then 5 green; final shared 72/72
  class S3 tested
  %% evidence S3: /tmp/i18n-workflow-runs-final-regressions.log 72/72; targeted eslint and ui-wiring pass
  class S4 tested
  %% evidence S4: evidence/i18n-workflow-runs-6169/browser.log: real API/PG owned summaries, 1/1, 3m57s cleanup1s; screenshots inspected375/1280; 72 regressions
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
