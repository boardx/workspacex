# 执行计划 — 报告严格来源策略

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：让新报告证据与恢复严格遵守已经确认的 restrict 来源范围。
- **完成判据**：域外正文不送入证据模型、域外引用无法保存、策略变更不能复用旧恢复依据；研究回归、类型、lint、init 通过；独立 PR 的 CI 绿。
- **不做什么**：不改变公开 API、内部资料鉴权、正式报告质量门、签核状态；不合并 PR。
- **假设与待确认**：本修复恢复已有来源范围规则。需求到大纲漂移与精准重试分别继续追踪，不宣称完整研究质量通过。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：报告遵守既有限定来源])
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
  %% evidence S1: 公开合成终态离线探针：9个来源/4域外→5个来源/0域外，数据库写入0、模型调用0；README.md
  class S2 tested
  %% evidence S2: initial-red-result.txt与report-save-red-result.txt定位真实绕过，后续tests-result.txt 143通过
  class S3 tested
  %% evidence S3: 共享来源匹配器、恢复hash、报告引用校验；tests-result.txt 9文件143通过
  class S4 tested
  %% evidence S4: tests-result.txt 9文件144通过；内部ID及scheme/port先红反例已修复；类型、lint、init exit0
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-02 | G, S1 | todo → doing | 接到目标，开始理解 |
