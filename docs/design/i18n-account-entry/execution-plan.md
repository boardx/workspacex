# 执行计划 — Account entry localization / #6155

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Localize registration, verification and reset while preserving credentials/tokens and request semantics
- **完成判据**：Account-entry and existing auth regressions; typed resource checks; web static gates; registered public-entry browser journey
- **不做什么**：No auth policy, API, schema, token consumption, cooldown or routing changes
- **假设与待确认**：Explicit parallel #6155, existing global zh-CN/en provider; new branch includes latest develop/main ancestry

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：Account entry localization])
  S1[1. Confirm public auth and policy boundaries]
  S2[2. Fail locale, token and input acceptance tests]
  S3[3. Translate copy and keep failures as metadata]
  S4[4. Regressions and real public-entry browser]
  S5[5. Independent PR and final checks]

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
  %% evidence S4: independent base41 unit+public browser2/2;evidence/i18n-account-entry-6155/isolated-browser-green.log
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
