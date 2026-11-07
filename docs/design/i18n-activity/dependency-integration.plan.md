# 执行计划 — PR6147 integration of merged maintenance dependencies

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：合入已merge的6195/6197最新develop，保留activity自身delta，fresh CI交付至actualmerge
- **完成判据**：14ownblob parity、44范围cases、dictESLint、normalhooks、新source全绿canonicalREADY、actualmergedAt
- **不做什么**：不复制补丁、不重跑旧204c、不恢复新切片、不改断言/timeout
- **假设与待确认**：main明确自动授权，一三期窗口已请求，最新actualdevelop44aeac6e包含6195/6197

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
  class S2 done
  class S3 done
  class S4 tested
  %% evidence S4: fresh44cases and ESLint exit0;14ownblob parity;merged dependencies identical44ae; evidence44ae-*.log; CI still pending
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03T15:44Z | G, S1 | todo → doing | 接到目标，开始理解 |
