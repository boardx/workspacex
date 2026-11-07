# 执行计划 — #6353 local microphone check

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：显式触发的8秒本地短句检查、真实电平与设备名称、释放与清理
- **完成判据**：定向115项测试、lint、独立Chromium合成音频生命周期验证；命令见handoff.md
- **不做什么**：仅rec工作区、新组件与hook、rec i18n与对应测试；不修改ASR与服务器音频删除
- **假设与待确认**：真人短句准确率和应用壳人工复测由主会话执行

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

  class G tested
  %% evidence G: 115 tests, lint与Chromium日志见handoff.md
  class S1 tested
  %% evidence S1: 115 tests, lint与Chromium日志见handoff.md
  class S2 tested
  %% evidence S2: 115 tests, lint与Chromium日志见handoff.md
  class S3 tested
  %% evidence S3: 115 tests, lint与Chromium日志见handoff.md
  class S4 tested
  %% evidence S4: 115 tests, lint与Chromium日志见handoff.md
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-07 | G, S1 | todo → doing | 接到目标，开始理解 |
