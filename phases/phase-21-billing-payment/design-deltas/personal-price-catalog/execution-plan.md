# 执行计划 — 服务端中美商品目录 #6089

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：真实 API 返回可信部署市场对应的 Pro 月年付及充值包目录。
- **完成判据**：支付渠道专项测试、API typecheck/lint、真实 HTTP 金额/币种/鉴权/非法查询/503 边界通过。
- **不做什么**：本项不收款、不发额度、不执行脏数据重置；UI接线和支付购买由后续交付完成。
- **假设与待确认**：按已确认个人支付设计；CN=CNY、US=USD、DevApp目录为CNY，渠道可用性复用配置单源。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：真实中美商品目录])
  S1[1. 定义精确金额与HTTP验证]
  S2[2. 服务端目录与市场配置]
  S3[3. HTTP与既有PrincipalGuard接线]
  S4[4. 类型与lint及独立审查]
  S5[5. 独立PR与正常集成develop]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 目标service缺失时测试退出1；实际金额和HTTP断言已固定，证据将归档evidence/
  class S2 done
  class S3 tested
  %% evidence S3: 支付专项及HTTP边界通过，最终输出见evidence/provider-tests.txt
  class S4 tested
  %% evidence S4: API typecheck/lint退出0，provider41项通过，独立审查6/6；证据evidence/
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-01 | G, S1 | todo → doing | 接到目标，开始理解 |
