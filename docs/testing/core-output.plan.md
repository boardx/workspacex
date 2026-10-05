# 执行计划 — {{GOAL_TITLE}}

> 规范：`.harness/instructions/execution-plan-visualization.md`。
> 改状态用 `node .harness/scripts/execution-plan.mjs set <本文件> <节点> <状态>`，
> 改完 `check` 一遍；不要手改 classDef 颜色。

## 我理解的目标
- **目标**：修复画布、PDF、Word输出和文件预览链，验证真实PPTX文件。
- **完成判据**：本地生产导出函数实际生成文件，非零页PDF、真实OOXML及完整中文回读；相关测试和Web类型检查通过。
- **不做什么**：不重跑数字人16例，不调用模型、真实DB，不部署或修改权限。
- **假设与待确认**：PDF采用明确标注的浏览器打印另存路径；DevApp端到端和Office客户端显示另行验收。

## 执行计划

图例：⬜ 灰=未开始 · 🟨 黄=已开始 · 🟩 绿=已完成 · 🟪 紫=已测试（有证据） · 🟥 红=被堵塞

```mermaid
flowchart TD
  G([目标：核心输出可用])
  S1[1. 修复画布字面实体保存与旧预览状态]
  S2[2. 替换假PDF为真实打印导出]
  S3[3. 替换伪Word并固定表格列宽]
  S4[4. 验证PDF DOCX PPTX与画布真实文件]
  S5[5. 完成回归类型检查和本地交接]
  S6[6. 验收DevApp模型客户端及标准下载链]

  G --> S1
  G --> S2
  G --> S3
  S1 --> S4
  S2 --> S4
  S3 --> S4 --> S5 --> S6

  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827

  class G doing
  class S1 tested
  %% evidence S1: 17 save-state tests and real file roundtrip exit0; docs/testing/core-output/canvas-save-tests.txt
  class S2 tested
  %% evidence S2: production guided DOM + production print iframe generated 3-page Chinese PDF in Chromium; docs/testing/core-output/pdf-verification.json
  class S3 tested
  %% evidence S3: 2 actual integrated DOCX outputs ZIP/XML/Chinese/column width verification exit0; docs/testing/core-output/word-inspection.json
  class S4 tested
  %% evidence S4: real Chromium PNG/PDF, 2 DOCX, 3 PPT tests and file readback exit0; docs/testing/core-output/artifact-manifest.json
  class S5 tested
  %% evidence S5: 37 web + 17 canvas tests passed, Web tsc exit0; docs/testing/core-output/README.md
  class S6 blocked
  %% blocked S6: no new model/deployment authorization; real organization identity/client confirmation not validated; historical standard-download trusted hash bridge missing
```

## 进度日志（append-only，每次改颜色追加一行）
| 时间 | 节点 | 状态变化 | 依据（命令 / 证据 / 堵塞原因） |
|---|---|---|---|
| 2026-10-05 | G, S1 | todo → doing | 接到目标，开始理解 |
