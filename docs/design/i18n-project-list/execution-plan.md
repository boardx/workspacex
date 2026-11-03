# 执行计划 — Project list localization / #6160

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Localize project list and create dialog while preserving original names, tags, payloads and role boundaries
- **完成判据**：Project/list/create/tag regressions, typed resources, real API/DB browser and role denial, affected static gates
- **不做什么**：No auth policy, API, schema, token consumption, cooldown or routing changes
- **假设与待确认**：Explicit parallel #6160, existing global zh-CN/en provider; new branch includes latest develop/main ancestry

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：Project list localization])
  S1[1. Confirm live project and shared UI boundaries]
  S2[2. Fail locale, list, raw-name/tag and payload tests]
  S3[3. Translate copy and keep failure metadata]
  S4[4. Regressions and real project create/persist browser]
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
  %% evidence S4: independent develop base:109 unit +2 real browser;evidence/i18n-project-list-6160/isolated-browser-green.log
  class S4 tested
  class S5 doing
```

## 进度日志（append-only）
| 时间 | 节点 | 状态变化 | 依据 |
|---|---|---|---|
| 2026-11-03 | S1 | todo → done | Fresh main/develop; actual contract and membership source, shared primitive scope |
| 2026-11-03 | S2 | todo → doing | Define direct API-boundary locale and original-value acceptance |
