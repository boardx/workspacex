# 执行计划 — 百炼公开模型目录与后台体验

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：导入可审查的百炼公共规格快照，在后台搜索分类查看详情，区分组织可调用状态。
- **完成判据**：strict 契约测试、Web 交互回归、typecheck / lint、真实组件响应式浏览器验收及正常 PR 门控。
- **不做什么**：不写组织数据库，不自动启用模型，不调用供应商推理，不冒充账号全量或完整 API 参数。
- **假设与待确认**：用户已接受公共 JSON + 组织数据库分离；账号地域与价格保持待核验。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：可审查公共目录与安全后台体验])
  S1[1. 确认目录与准入边界]
  S2[2. 核验十四份官方指南]
  S3[3. 实现 JSON 校验与分类详情]
  S4[4. 验证交互与响应式组件]
  S5[5. 完成独审与草稿 PR]

  G --> S1 --> S2 --> S3 --> S4 --> S5

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: contract tests 5 passed; evidence/contract-tests.txt
  class S2 tested
  %% evidence S2: 14 official content hashes match; evidence/source-audit.json; offline refresh 5 passed
  class S3 tested
  %% evidence S3: contracts and Web typechecks / ESLint exit 0; evidence/validation.md
  class S4 tested
  %% evidence S4: Web 16 passed; 3 viewport browser checks and axe no violations; evidence/browser-results.json
  class S5 doing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-05 | G, S1 | todo → doing | 接到目标，开始理解 |
