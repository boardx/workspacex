# 执行计划 — 中美永久充值 #6090

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：真实支付订单按可信市场购买三档永久充值，币种及金额正确，重复通知只入账一次。
- **完成判据**：支付渠道专项测试、API typecheck/lint、真实 HTTP 金额/币种/鉴权/非法查询/503 边界通过。
- **不做什么**：本项不实现Pro订阅、统一checkout、赠送及旧数据重置。
- **假设与待确认**：按已确认个人支付设计；CN=CNY、US=USD、DevApp默认CNY并支持服务端USD测试配置，渠道可用性复用配置单源。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：中美永久充值])
  S1[1. 定义USD与重复入账验证]
  S2[2. 生成套餐迁移与市场保护]
  S3[3. Stripe与收银台USD接线]
  S4[4. 数据库验证与独立审查]
  S5[5. 独立PR与正常集成develop]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 旧实现Stripe拒绝USD及前端无支付链接红测，见evidence/
  class S2 done
  class S3 tested
  %% evidence S3: provider51项、cashier51项、PG27项通过，见evidence/
  class S4 tested
  %% evidence S4: tested
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-01 | G, S1 | todo → doing | 接到目标，开始理解 |
