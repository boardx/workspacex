# 执行计划 — AIDT native PR and develop merge

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Submit and merge the native V2 teaching module into develop after actual CI and review; prepare DevApp testing through the existing release path.
- **完成判据**：Current-head required checks and independent source review pass; GitHub confirms merged=true. DevApp has separate native release and browser verification.
- **不做什么**：No production deployment, permission changes, forged signoff, or schema gate bypass.
- **假设与待确认**：User has explicitly authorized PR and merge. Actual DevApp schema/runtime prerequisites remain to be checked.

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：submit reviewed AIDT PR and merge develop])
  S1[1. Confirm user scope and latest develop]
  S2[2. Audit full feature history and credentials]
  S3[3. Fix integration and release boundary findings]
  S4[4. Verify local changes and current-head CI]
  S5[5. Review exact head and merge develop]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: git fetch latest develop and isolated merge 1a2ec212d; root instructions and user merge authorization read
  class S2 tested
  %% evidence S2: publication-audit.md and credential-history-scan.json: 94 commits / 2142 blobs, zero credential matches
  class S3 tested
  %% evidence S3: contracts1504, Web818+shared192, API625, Python241+2skip, release34+9+5; strict secret0new and route72pass receipts
  class S4 doing
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-17 UTC | G, S1 | todo → doing | 接到目标，开始理解 |
