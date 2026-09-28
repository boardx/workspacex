# 执行计划 — Work Stack（200 Skill / 60 Workflow / 60 Agent）

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 方案正文：`docs/proposals/PROP-WORK-STACK-001.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：在现有架构上交付 Work Stack——用户选一个带头像的角色 Agent（=数字人），它组合已发布的 Skill 和 Workflow，在权限和人工审批下把真实工作做完或升级给人，全程可审计、可回放；最终规模 200 Skill / 60 Workflow / 60 Agent，分三个 Stage。
- **完成判据**：每个 Stage 的出口条件由 `pnpm harness verify` 和 G0–G6 门脚本判定；Stage 1 = 研究员 / 产品经理 / 销售三条链路端到端通过，50/20/10 实体有基线评测，越权副作用为 0。
- **不做什么**：不建 DigitalHuman 第二身份实体、不建第二套 agent 内核或记忆库、不做 Workflow DSL（推迟到 Stage 3）、不在本项目里合并两套 Skill 模型。
- **假设与待确认**：需求以 main #4502 为权威；D1–D7 七个决策待人类拍板（见方案第 9 节）——**在拍板前不开工**。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：交付 Work Stack 200 Skill / 60 Workflow / 60 Agent])
  R1[1. 勘探现有 Skill / Agent / Workflow / harness 架构]
  R2[2. 写完整方案 PROP-WORK-STACK-001]
  H1{3. 人类批准方案并拍板 D1–D7?}
  P0[4. Phase 0：收敛需求 + composition.yaml + ADR-116~121]
  H2{5. 建 phase-20 + 原型 + 5 个契约束，人类签核?}
  A1[6a. Skill 元数据 + 目录表]
  A2[6b. 通用 Workflow Runtime + 迁移引导式研究]
  A3[6c. Agent 扩展：头像 / 分类 / 白名单 / 委派 / 升级]
  A4[6d. Eval Runner + G0–G4 门脚本]
  V1[7. 验证三条试点链路：研究员 / 产品经理 / 销售]
  C1[8. 补齐 Stage 1：50 Skill / 20 Workflow / 10 Agent]
  X1[9. Stage 2 → Stage 3：扩到 200 / 60 / 60 + 生产治理]

  G --> R1 --> R2 --> H1
  H1 -- 批准 --> P0 --> H2
  H2 -- 签核 --> A1 & A2 & A3 & A4
  A1 & A2 & A3 & A4 --> V1 --> C1 --> X1

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class R1 done
  class R2 done
  class H1 blocked
  %% blocked H1: 等人类批准方案并拍板 D1–D7（方案第 9 节）
  class P0 todo
  class H2 todo
  class A1 todo
  class A2 todo
  class A3 todo
  class A4 todo
  class V1 todo
  class C1 todo
  class X1 todo
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-09-28 | G, R1 | todo → doing | 接到目标，开始勘探 |
| 2026-09-28 | R1 | doing → done | 4 路勘探完成（Skill / Agent / Workflow / harness），结论写入方案 §1 |
| 2026-09-28 | R2 | todo → done | 方案已提交到 `claude/tender-maxwell-dh21fg` |
| 2026-09-28 | H1 | todo → doing | 方案交人类审阅，等 D1–D7 拍板 |
