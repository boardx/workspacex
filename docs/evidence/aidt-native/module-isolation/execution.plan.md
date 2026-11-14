# 执行计划 — AIDT 独立模块 六路并行隔离

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：AIDT 通过显式开关接入，关闭后保留已有Project/Chat/导航与Skill目录行为。
- **完成判据**：开关开/关兼容测试、组/身份切换反证、模块依赖门禁、相关web/API测试和typecheck；UI仍可审阅。
- **不做什么**：不部署、不改权限/数据库/新API、不冒签设计、不重试被拒绝的GitHub外发；不声称完整P0已交付。
- **假设与待确认**：6小时是本轮冲刺目标；先完成模块隔离，新增共享状态/消息契约仍待评审。继续保留上一轮Demo和所有用户修改。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：AIDT 独立模块且原功能兼容])
  S1[1. 六路范围与当前影响面]
  S2[2. 入口与路由开关]
  S3[3. 原生Chat适配隔离]
  S4[4. 教学状态与组身份隔离]
  S5[5. 资源权限与取消边界]
  S6[6. 后端Skill注册默认关闭]
  S7[7. 兼容性与模块门禁]
  S8[8. 收拢features模块并交叉测试]
  S9[9. 交付与剩余项]

  G --> S1
  S1 --> S2 & S3 & S4 & S5 & S6 & S7
  S2 & S3 & S4 & S5 & S6 & S7 --> S8 --> S9

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G tested
  %% evidence G: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S1 tested
  %% evidence S1: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S2 tested
  %% evidence S2: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S3 tested
  %% evidence S3: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S4 tested
  %% evidence S4: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S5 tested
  %% evidence S5: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S6 tested
  %% evidence S6: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S7 tested
  %% evidence S7: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S8 tested
  %% evidence S8: docs/evidence/aidt-native/module-isolation/README.md；latest-*.txt 与 state-aba-*.txt
  class S9 doing

```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-11-15 06:40 北京时间 | G, S1 | todo → doing | 接到目标，开始理解 |
