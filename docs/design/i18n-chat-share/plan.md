# 执行计划 — Public chat sharing — #6176

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：Localize owner and anonymous sharing controls while retaining content and request state.
- **完成判据**：Provider tests, share regressions, real publish/read/revoke browser, exact review, normal push and CI.
- **不做什么**：No protocol, owner policy, snapshot content, token or publication behavior changes.
- **假设与待确认**：Existing approved zh-CN/en approach; independent current develop dec5223e5.

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
  class S2 tested
  %% evidence S2: /tmp/i18n-chat-share-red.log 4 fail; /tmp/i18n-chat-share-green.log 17 pass
  class S3 tested
  %% evidence S3: 35/35 selected cases, targeted ESLint, exact sourceccd7a80d0 review no findings
  class S4 tested
  %% evidence S4: evidence/i18n-chat-share-6176/browser.log: real publish/read/reload/revoke1/1,5m53s,375&1440 inspected,4stacks0
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-03 | G, S1 | todo → doing | 接到目标，开始理解 |
