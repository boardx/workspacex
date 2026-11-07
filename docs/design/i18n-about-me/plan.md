# 执行计划 — About me localization and editing continuity — #6174

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Localize About me while retaining draft/focus/selection/in-flight request behavior.
- **完成判据**：Locale/error/no-replay/raw-data tests; existing memory regressions; bounded production browser; exact review; normal push/CI.
- **不做什么**：Other personal-memory list, consolidation, sharing dialogs and extraction/model runtime remain separate.
- **假设与待确认**：Explicit optional locale for shared origin/badge helpers; default Chinese unchanged; existing approved i18n approach.

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

  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: /tmp/i18n-about-me-red.log:3fail1compat pass; first4green; currentbase50/50
  class S3 tested
  %% evidence S3: /tmp/i18n-about-me-current-base-regressions.log:50/50, defaults/draft/error/no-replay/raw values
  class S4 tested
  %% evidence S4: evidence/i18n-about-me-6174:50 selected cases,22-code default parity, canonical production browser1/1, realHTTP revision/reload/goal transfer,375&1280 screenshots; seed replay2x0; all4 stacks0
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
