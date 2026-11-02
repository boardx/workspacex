# 执行计划 — Enterprise platform management #6108

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：平台人员对无已付 Team 的组织手动升级 Enterprise 并原子添加额度。
- **完成判据**：已有 PG/HTTP 19 与 UI/client 18 项通过；剩余只验新增留存边界及真实断响应浏览器，完整回归由必要 CI 验证。
- **不做什么**：已付 Team 续费取消与保留计划由后续完整支付适配实现，本轮失败关闭。
- **假设与待确认**：已签核设计；依赖容量许可单源、当前财务代际和正式 Enterprise operations。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：Enterprise 平台升级与额度])
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
  %% evidence S4: evidence/enterprise-management-6108/backend-19.txt; ui-client-final.txt; browser-final.txt; retention-pg.txt
  class S4 tested
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-02 | G, S1 | todo → doing | 接到目标，开始理解 |
