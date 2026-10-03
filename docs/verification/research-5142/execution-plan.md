# 执行计划 — 研究证据来源正文复核修复 #5142

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：已抓取来源以正文复核相关性，并以块内原文编号防止抄写及归属错误。
- **完成判据**：研究 API 测试、typecheck、独立审查及真实公开资料模型重放；PR CI 全绿。
- **不做什么**：不放宽原文归属、原子重试或报告质量门，不修改公共 API。
- **假设与待确认**：沿用已授权的既有契约修复，依赖 PR #5134，禁止合入 main。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：可靠复核已读取来源])
  S1[1. 理解目标并确认完成判据]
  S2[2. 真实失败诊断与失败用例]
  S3[3. 实现最小改动]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：PR / 交接]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  %% evidence S1: https://github.com/boardx/workspacex/issues/5142
  %% evidence S2: /private/tmp/research-5142-red.log (5 failed, 6 passed before implementation)
  %% evidence S3: /private/tmp/research-5142-unit.log (202 PASS), /private/tmp/research-5142-typecheck.log (exit 0)
  class G doing
  class S1 tested
  class S2 tested
  class S3 tested
  class S4 doing
  class S5 doing
```

