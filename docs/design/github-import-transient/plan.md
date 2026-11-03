# 执行计划 — GitHub 只读导入瞬时故障有界恢复 #6194

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：同一已校验 GitHub GET 遇502/503/504/ECONNRESET时有界恢复，不能放过持续失败或SSRF
- **完成判据**：先反例RED，恢复/耗尽/取消/deadline/RetryAfter/host/redirect反例GREEN；真实原导入单spec、正常hooks、新PR CI
- **不做什么**：不改i18n头、不POST重放、不跳过公网GitHub验收、不增超时或盲rerun
- **假设与待确认**：main授权；一三期明确空窗；固定总预算10s、最多两个transient重试，现有quota只一次且共同受总deadline限制

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
  class S4 blocked
  %% blocked S4: 49units/type/lint green; public browser IMPORT_FETCH_TIMEOUT, baseline paired same timeout; main authorizes draft, standard CI acceptance required
  class S5 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
