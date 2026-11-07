# 执行计划 — Structured activity display / #6145

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Translate system activity templates while preserving user values and legacy summary responses
- **完成判据**：Contract/UI tests, API/frontend static checks, and existing real self-service-profile browser journey with legacy and negotiated API assertions
- **不做什么**：No auth/access/query-scope/database changes; no summary regex or raw provenance detail exposure
- **假设与待确认**：User explicitly requested new display code/params; negotiate structured-v1 because legacy schema is strict

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：Structured activity display])
  S1[1. Confirm compatibility and whitelist]
  S2[2. Fail contract and UI acceptance tests]
  S3[3. Implement opt-in projection and display]
  S4[4. Verify legacy and new real journeys]
  S5[5. Independent PR and checks]

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
  %% evidence S4: 8contract +11API +24UI; real HTTP/browser passed incl cleanup; evidence/i18n-activity-6145; final push gate pending
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
