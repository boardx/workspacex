# 执行计划 — {{GOAL_TITLE}}

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：重构 D011 为斯坦福 d.school 教授背景的虚拟设计思维数字人，支持全球传播、企业应用、AI×DT 和未来教育，并掌握全部可见画布。
- **完成判据**：角色包契约测试通过；内置模板逐个生成和保存回读；组织模板按授权目录发现；部署和真实模型表现分别验收。
- **不做什么**：不虚构现实任职，不扩大权限，不修改冻结16例，不进行新模型外发或生产部署。
- **假设与待确认**：源码目录可核查；devapp当前部署目录和组织自定义模板尚未读取。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：D011角色与全画布能力])
  S1[1. 核查真实模板目录与调用链]
  S2[2. 重构教授背景与四个研究方向]
  S3[3. 接入动态模板选择与完整输出规则]
  S4[4. 逐模板验证生成编辑保存回读]
  S5[5. 记录本地结果与部署验收边界]
  S6[6. 验收devapp真实模型生成渲染保存]

  G --> S1
  G --> S2
  S1 --> S3
  S2 --> S3 --> S4 --> S5 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 20 registry names and Chinese requests matched; docs/testing/d011-reconstruction/canvas-roundtrip-results.json
  class S2 tested
  %% evidence S2: 44 unit tests exit0 and API tsc exit0; docs/testing/d011-reconstruction/unit-tests.txt
  class S3 tested
  %% evidence S3: dynamic canvas guidance regression passed; docs/testing/d011-reconstruction/unit-tests.txt
  class S4 tested
  %% evidence S4: 20/20 generation edit file parse roundtrip exit0; docs/testing/d011-reconstruction/canvas-roundtrip-results.json
  class S5 done
  class S6 blocked
  %% blocked S6: devapp deployment and organization-role upgrade not authorized this round; no new exact model-call authorization; do not autogrant
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-05 | G, S1 | todo → doing | 接到目标，开始理解 |
