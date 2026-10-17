# 执行计划 — Stripe 状态与恢复契约提案

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：补齐订阅状态/账单恢复语义，防止重复售卖和错误权益。
- **完成判据**：文档独立复核无阻塞，execution-plan/OSS机械检查通过，独立提案PR可审阅。
- **不做什么**：本提案不改人类签核、公开schema、运行时或feature状态。
- **假设与待确认**：保留原Stripe状态原样落库裁决；新资格映射待人类采纳。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([Stripe 订阅状态可验证])
  S1[1. 核对已签规则与官方状态]
  S2[2. 补齐状态和绑定异常规则]
  S3[3. 独立复核提案与链接]
  S4[4. 执行文档机械检查]
  S5[5. 提交提案并等待采纳]

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
  %% evidence S4: source56b9653d3 plan-check/OSS/scope-links exit0; verification.md and rawtxt; document ACCEPT, no runtime acceptance.
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-17 | G, S1 | todo → doing | 接到目标，开始理解 |
