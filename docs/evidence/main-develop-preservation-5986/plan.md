# 执行计划 — 保留两边优化并整合 develop/main

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：先将 main 同步至 develop，验证优化与修复保留，再晋级 main。
- **完成判据**：文件内容与祖先审计通过；用量/聊天测试与浏览器检查通过；两次 PR required gates 通过；最终 main 包含双方基线。
- **不做什么**：不执行 CN 生产发布、不强推、不覆盖分支、不回退优化。
- **假设与待确认**：沿用本会话工作树；用户已授权此次整合与晋级；main/develop SHA 见 baselines.json。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：保留优化并整合分支])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 合并并验证双方内容]
  S4[4. 跑验证命令留证据]
  S5[5. 先合入 develop 再晋级 main]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 done
  class S2 done
  class S3 doing
  class S4 todo
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-29 | G, S1 | todo → doing | 接到目标，开始理解 |
