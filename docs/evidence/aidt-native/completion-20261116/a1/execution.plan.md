# 执行计划 — 安全读取模型配置与只读诊断

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：显式读取 cn.local.env，仅提取模型字段并给出脱敏诊断。
- **完成判据**：node --test scripts/tests/real-model-config.test.mjs；现有 smoke 退出码测试；真实缺文件诊断。
- **不做什么**：不部署、不迁移、不修改签核、不将 CN 配置注入 AIDT zero-egress profile。
- **假设与待确认**：云环境未找到 cn.local.env；配置完整不代表真实连通；基础验证由主 Agent 统一执行。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：安全模型诊断])
  S1[1. 理解目标并确认完成判据]
  S2[2. 勘探现状 / 定位要改的地方]
  S3[3. 实现白名单诊断与显式 smoke 接线]
  S4[4. 跑验证命令留证据]
  S5[5. 记录边界并提交交接]
  S6[6. 验收实际文件与真实模型]

  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G blocked
  %% blocked G: 安全工具开发与定向测试完成；真实模型因配置文件缺失无法验收。
  class S1 tested
  %% evidence S1: node --test scripts/tests/real-model-config.test.mjs → config-tests.txt 13/13；规则与范围见 model-configuration.md
  class S2 tested
  %% evidence S2: 既有 smoke/VM 6/6；动态缺文件诊断见 missing-file-diagnostic.txt
  class S3 tested
  %% evidence S3: node --test scripts/tests/real-model-config.test.mjs → config-tests.txt 13/13
  class S4 tested
  %% evidence S4: config-tests.txt 与 verification.md：13个新测试和6个既有测试通过；JS/shell语法通过
  class S5 tested
  %% evidence S5: git diff --check 与 execution-plan check 通过；交接见 verification.md
  class S6 blocked
  %% blocked S6: 当前云环境无可读cn.local.env；需在实际持有文件的机器运行诊断和真实验收。没有模型连通证据。
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-16 | G, S1 | todo → doing | 接到目标，开始理解 |
