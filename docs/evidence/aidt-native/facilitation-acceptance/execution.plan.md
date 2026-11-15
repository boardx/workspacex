# 执行计划 — 历史引导场景与原生Agent验收

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：核对既有V2，补足群体引导场景的原生Chat真实模型采集与人工审阅入口。
- **完成判据**：用例目录与人工判据可检查，采集器复用现有真实模型配置、原生Chat和持久消息契约；单元、类型和显式未配置路径通过。真实模型缺失必须标阻塞。
- **不做什么**：不改变现有Chat UI、不升级已发布Skill、不自动开启匿名投票/私信/录音、不触生产或增加服务契约。
- **假设与待确认**：历史指南已读取；现环境无模型凭据、真实Agent端点和专用验收账号，质量验收需配置后运行并由人审阅。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：补足真实Agent引导场景])
  S1[1. 核对历史章节和V2已有覆盖]
  S2[2. 对齐现有真实模型通道]
  S3[3. 原生采集与人工审阅用例]
  S4[4. 本地测试与缺配置反证]
  S5[5. 真实模型行为验收]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G blocked
  %% blocked G: 可独立推进的验收准备已完成；真实模型行为仍需受控本机Agent链路、账号及人工审阅
  class S1 tested
  %% evidence S1: source-context.json与checks/source-intake.json：原文指定7节读取成功，历史参考与现有能力分开
  class S2 tested
  %% evidence S2: checks/runtime-unchanged.json；原config/Chat/backend保持原字节，原构建回执仍usable=true
  class S3 done
  class S4 tested
  %% evidence S4: checks/tests.txt 35通过；typecheck/eslint退出0；缺配置2项显式skip而非模型通过
  class S5 blocked
  %% blocked S5: 未配置真实模型/Agent链路和专用试用账号；不得用fixture或静态断言计为模型行为通过
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-15 | G, S1 | todo → doing | 接到目标，开始理解 |
