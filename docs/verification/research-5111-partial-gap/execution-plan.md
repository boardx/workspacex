# 执行计划 — 诚实部分证据缺口复核

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：避免把复合问题的诚实部分缺口误当忽略已有证据，质量门不降低
- **完成判据**：隔离研究质量及章节回归、API typecheck/lint、init快速基线及独立exact SHA review；PR CI全绿且不合并
- **不做什么**：不改公开schema/签核、引用门或正式报告门；不验证导出
- **假设与待确认**：可逆实现沿用已有诚实缺口规则；真实质量/耗时改善需要后续同配置证据

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：严格复核部分覆盖缺口])
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
  class S1 tested
  %% evidence S1: 公开合成探针及initial-red-result.txt：8失败8通过定位判定冲突
  class S2 tested
  %% evidence S2: tests-result.txt：完整证据、部分覆盖、异常、32/33上界与正式门反例通过
  class S3 tested
  %% evidence S3: tests-result.txt：7文件122项通过；不改变公开schema或gap状态
  class S4 tested
  %% evidence S4: tests-result.txt 122通过；类型/lint及默认init快速路径exit0
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-02 | G, S1 | todo → doing | 接到目标，开始理解 |
