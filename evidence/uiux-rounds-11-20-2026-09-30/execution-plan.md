# 执行计划 — 第二组十轮 UIUX 迭代

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：最新 main 上完成第11–20轮真实浏览器测试、修复、回归与PR，目标9.1/10
- **完成判据**：逐轮截图、真实流程证据、测试/typecheck/lint与PR CI通过；评分由证据支持
- **不做什么**：不改变权限或生产配置，不伪造模型/邮件结果
- **假设与待确认**：本地模型与邮件能力先验证；缺失功能不计通过

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：第11–20轮修复并推进9.1验收])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 实现最小改动]
  S4[4. 跑验证命令留证据]
  S5[5. 收尾：PR / 交接]
  S6[6. 独立评分与真实闭环验收]

  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: report.md；screenshots/；424条受影响测试通过
  class S2 tested
  %% evidence S2: report.md；screenshots/；424条受影响测试通过
  class S3 tested
  %% evidence S3: report.md；screenshots/；424条受影响测试通过
  class S4 tested
  %% evidence S4: validation.md：最新main上verify:quick退出0，757文件6363测试通过、5跳过；typecheck/lint绿；真实模型浏览器证据归档
  class S5 doing
  class S6 blocked
  %% blocked S6: local env真实模型对话/反馈/研究主题与计划成功；资料研究启动失败、零来源；ASR、GitHub分诊/邮件与最终SHA独立评分仍待验收
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-09-30 | G, S1 | todo → doing | 接到目标，开始理解 |
