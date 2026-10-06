# 执行计划 — 修复工作坊画布插入与位置预览

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：JTBD 等工作坊画布正常插入 Board，用户通过简化概览选择位置，无需输入坐标。
- **完成判据**：受影响 web/API/contracts 测试、类型检查、lint 和三档真实浏览器交互通过；PR CI 通过。
- **不做什么**：仅修复 Chat → Board 模板传输、来源验证、位置选择与源码回读。
- **假设与待确认**：用户授权跳过身份确认；不发布生产。图片与特殊 Mermaid 图形仍走既有拒绝分支。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：画布插入与可视化选位])
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
  class S4 tested
  %% evidence S4: web-tests.log / api-tests.log / contracts-tests.log / browser-results.json
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-06 | G, S1 | todo → doing | 接到目标，开始理解 |
