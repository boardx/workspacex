# 执行计划 — 无证据章节与未审核正文隔离 #5179

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：跳过无证据写作，让结论事实只来自质量通过章节
- **完成判据**：针对测试、完整研究回归、API typecheck、独立审查及PR CI通过
- **不做什么**：不修改已确认问题、不放宽全局证据或正式报告门，不合入main
- **假设与待确认**：沿用已授权修复；保留真实context引用，只跳过零可用引用章节

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：诚实呈现证据缺口])
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
  class S2 tested
  %% evidence S2: /private/tmp/research-5179-red.log: 4 failed / 67 passed
  class S3 tested
  %% evidence S3: /private/tmp/research-5179-unit.log 211 PASS; /private/tmp/research-5179-typecheck.log exit 0
  class S4 tested
  %% evidence S4: 492 research tests; API typecheck; exactSHA ACCEPT; final captured replay and memory promotion rejection; overall semantic FAIL retained
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-03 | G, S1 | todo → doing | 接到目标，开始理解 |
